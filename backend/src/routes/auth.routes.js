import crypto from 'node:crypto';
import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { config } from '../config.js';
import { one, query, tx } from '../db.js';
import { HttpError, badRequest, parse, unauthorized } from '../errors.js';
import { clearSessionCookie, publicUser, requireUser, setSessionCookie } from '../middleware/auth.js';
import { audit } from '../services/audit.js';
import { directory } from '../services/directory/index.js';
import { loginCodeEmail, passwordResetEmail, sendMail } from '../services/mailer.js';
import { clientIp, isInternal, originLabel } from '../services/network.js';
import { checkPasswordPolicy, hashPassword, passwordMode, verifyPassword } from '../services/passwords.js';
import { getSettings } from '../services/settings.js';
import { randomToken, sha256, sixDigitCode } from '../services/tokens.js';

export const authRouter = Router();

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Trop de tentatives. Patientez quelques minutes avant de réessayer.' },
});

const emailSchema = z
  .string({ error: 'Adresse HPO Mail requise.' })
  .trim()
  .toLowerCase()
  .pipe(z.email({ error: 'Adresse e-mail invalide.' }));

const firstName = (fullName) => String(fullName || '').split(' ')[0] || '';
const maskEmail = (e) => e.replace(/^(.)(.*)(.@.*)$/, (_, a, mid, b) => a + '•'.repeat(Math.min(mid.length, 6)) + b);
const hmacCode = (challengeId, code) =>
  crypto.createHmac('sha256', config.session.secret).update(`${challengeId}:${code}`).digest('hex');

/** Met à jour le profil depuis l'annuaire HPO Mail (le nom ou le service ont pu changer). */
async function refreshFromDirectory(user) {
  try {
    const p = await directory.findByEmail(user.email);
    if (!p) return user;
    const rows = await query(
      `UPDATE users SET full_name = $2, department = $3, job_title = $4, site = $5, company = $6
        WHERE id = $1 RETURNING *`,
      [user.id, p.fullName, p.department, p.jobTitle, p.site, p.company],
    );
    return rows[0] ?? user;
  } catch {
    return user;
  }
}

async function completeLogin(req, res, user, { withMfa = false } = {}) {
  const fresh = await refreshFromDirectory(user);
  await query('UPDATE users SET last_login_at = now(), last_login_origin = $2 WHERE id = $1', [user.id, originLabel(req)]);
  await audit(req, withMfa ? 'Connexion avec double authentification' : 'Connexion', { actor: fresh });
  setSessionCookie(res, fresh);
  return res.json({ user: publicUser(fresh) });
}

// ---------------------------------------------------------------------
authRouter.get('/config', (_req, res) => {
  res.json({
    authProvider: config.authProvider,
    passwordMode, // create = mot de passe propre à HPO Visio ; verify = mot de passe HPO Mail
    mailDomains: config.mailDomains,
  });
});

authRouter.get('/me', requireUser, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

authRouter.post('/logout', async (req, res) => {
  if (req.user) await audit(req, 'Déconnexion');
  clearSessionCookie(res);
  res.json({ ok: true });
});

authRouter.post('/login', limiter, async (req, res) => {
  const body = parse(z.object({ email: emailSchema, password: z.string().min(1, 'Mot de passe requis.').max(512) }), req.body);

  // Blocage après 8 échecs en 15 minutes sur la même adresse
  const recent = await one(
    `SELECT count(*)::int AS n FROM audit_logs
      WHERE action = 'Échec de connexion' AND target = $1 AND created_at > now() - interval '15 minutes'`,
    [body.email],
  );
  if (recent.n >= 8) {
    throw new HttpError(429, 'Compte temporairement bloqué après plusieurs échecs. Réessayez dans 15 minutes.');
  }

  const user = await one('SELECT * FROM users WHERE email = $1', [body.email]);
  const ok = await verifyPassword(body.email, body.password, user?.password_hash);
  if (!user || !ok || user.status !== 'active') {
    await audit(req, 'Échec de connexion', {
      actor: { label: user?.full_name ?? 'Inconnu', id: user?.id },
      target: body.email,
      details: user && user.status !== 'active' ? { reason: 'compte désactivé' } : null,
    });
    if (user && ok && user.status !== 'active') {
      throw unauthorized('Votre compte HPO Visio est désactivé. Contactez la DSID.');
    }
    throw unauthorized('Adresse ou mot de passe incorrect.');
  }

  const settings = await getSettings();
  const needsMfa =
    (user.role === 'admin' && settings.admin_2fa) || (settings.external_2fa && !isInternal(clientIp(req)));

  if (!needsMfa) return completeLogin(req, res, user);

  const code = sixDigitCode();
  const challenge = await tx(async (c) => {
    await c.query('UPDATE login_challenges SET consumed_at = now() WHERE user_id = $1 AND consumed_at IS NULL', [user.id]);
    const { rows } = await c.query(
      `INSERT INTO login_challenges (user_id, code_hash, expires_at)
       VALUES ($1, 'pending', now() + interval '10 minutes') RETURNING id`,
      [user.id],
    );
    await c.query('UPDATE login_challenges SET code_hash = $2 WHERE id = $1', [rows[0].id, hmacCode(rows[0].id, code)]);
    return rows[0];
  });
  await sendMail({ to: user.email, ...loginCodeEmail({ firstName: firstName(user.full_name), code }) });
  res.json({ mfaRequired: true, challengeId: challenge.id, sentTo: maskEmail(user.email) });
});

authRouter.post('/verify', limiter, async (req, res) => {
  const body = parse(
    z.object({
      challengeId: z.uuid({ error: 'Demande de code invalide.' }),
      code: z.string().trim().regex(/^\d{6}$/, 'Le code contient 6 chiffres.'),
    }),
    req.body,
  );
  const user = await tx(async (c) => {
    const { rows } = await c.query(
      `SELECT lc.*, u.status FROM login_challenges lc JOIN users u ON u.id = lc.user_id
        WHERE lc.id = $1 FOR UPDATE OF lc`,
      [body.challengeId],
    );
    const ch = rows[0];
    if (!ch || ch.consumed_at || new Date(ch.expires_at) < new Date() || ch.status !== 'active') {
      throw badRequest('Ce code a expiré. Reconnectez-vous pour en recevoir un nouveau.', { restart: true });
    }
    if (ch.attempts >= 5) {
      await c.query('UPDATE login_challenges SET consumed_at = now() WHERE id = $1', [ch.id]);
      throw new HttpError(429, 'Trop d’essais. Reconnectez-vous pour recevoir un nouveau code.', { restart: true });
    }
    const expected = Buffer.from(ch.code_hash, 'hex');
    const given = Buffer.from(hmacCode(ch.id, body.code), 'hex');
    if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) {
      await c.query('UPDATE login_challenges SET attempts = attempts + 1 WHERE id = $1', [ch.id]);
      throw badRequest('Code incorrect.');
    }
    await c.query('UPDATE login_challenges SET consumed_at = now() WHERE id = $1', [ch.id]);
    const u = await c.query('SELECT * FROM users WHERE id = $1', [ch.user_id]);
    return u.rows[0];
  });
  return completeLogin(req, res, user, { withMfa: true });
});

// ---------------------------------------------------------------------
// Mot de passe oublié — seulement si le mot de passe est propre à HPO Visio
// ---------------------------------------------------------------------
authRouter.post('/forgot', limiter, async (req, res) => {
  if (passwordMode !== 'create') {
    throw badRequest('Votre mot de passe est celui de HPO Mail : changez-le dans HPO Mail ou auprès de la DSID.');
  }
  const { email } = parse(z.object({ email: emailSchema }), req.body);
  const user = await one(`SELECT * FROM users WHERE email = $1 AND status = 'active'`, [email]);
  if (user) {
    const token = randomToken();
    await query(
      `INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '1 hour')`,
      [user.id, sha256(token)],
    );
    const url = `${config.appUrl}/reinitialiser/${token}`;
    await sendMail({ to: user.email, ...passwordResetEmail({ firstName: firstName(user.full_name), url }) });
    await audit(req, 'Demande de réinitialisation du mot de passe', { actor: user });
  }
  // Réponse identique que le compte existe ou non
  res.json({ ok: true });
});

authRouter.post('/reset', limiter, async (req, res) => {
  if (passwordMode !== 'create') throw badRequest('Réinitialisation indisponible : mot de passe géré par HPO Mail.');
  const body = parse(z.object({ token: z.string().min(20).max(200), password: z.string().max(256) }), req.body);
  const policy = checkPasswordPolicy(body.password);
  if (policy) throw badRequest(policy);
  const hash = await hashPassword(body.password);
  const user = await tx(async (c) => {
    const { rows } = await c.query(
      `SELECT pr.*, u.status FROM password_resets pr JOIN users u ON u.id = pr.user_id
        WHERE pr.token_hash = $1 FOR UPDATE OF pr`,
      [sha256(body.token)],
    );
    const r = rows[0];
    if (!r || r.used_at || new Date(r.expires_at) < new Date() || r.status !== 'active') {
      throw badRequest('Ce lien n’est plus valable. Faites une nouvelle demande.');
    }
    await c.query('UPDATE password_resets SET used_at = now() WHERE id = $1', [r.id]);
    const u = await c.query('UPDATE users SET password_hash = $2 WHERE id = $1 RETURNING *', [r.user_id, hash]);
    return u.rows[0];
  });
  await audit(req, 'Mot de passe réinitialisé', { actor: user });
  res.json({ ok: true });
});
