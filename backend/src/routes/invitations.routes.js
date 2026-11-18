import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { HttpError, badRequest, conflict, parse } from '../errors.js';
import { publicUser, setSessionCookie } from '../middleware/auth.js';
import { audit } from '../services/audit.js';
import { inspectToken } from '../services/invitations.js';
import { roleLabel } from '../services/mailer.js';
import { checkPasswordPolicy, hashPassword, passwordMode, verifyPassword } from '../services/passwords.js';
import { sha256 } from '../services/tokens.js';
import { tx } from '../db.js';

/**
 * Page d'activation publique : /invitation/:token côté front.
 */
export const invitationsRouter = Router();

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Trop de tentatives. Patientez quelques minutes.' },
});

const MESSAGES = {
  unknown: ['Lien non valide', 'Ce lien d’invitation n’existe pas. Vérifiez que vous l’avez copié en entier.'],
  expired: ['Ce lien a expiré', 'Pour votre sécurité, un lien d’invitation n’est valable que quelques jours. Demandez à la DSID de vous en renvoyer un.'],
  used: ['Ce lien a déjà servi', 'Votre compte HPO Visio est déjà activé. Connectez-vous avec vos identifiants.'],
  revoked: ['Cette invitation a été annulée', 'La DSID a retiré cette invitation. Contactez-la si vous pensez que c’est une erreur.'],
  replaced: ['Ce lien a été remplacé', 'Un nouveau lien vous a été envoyé. Utilisez l’e-mail le plus récent de votre boîte HPO Mail.'],
  not_in_directory: ['Adresse introuvable dans l’annuaire', 'Votre adresse n’apparaît pas (ou plus) dans l’annuaire HPO Mail. Contactez la DSID.'],
};

invitationsRouter.get('/:token', limiter, async (req, res) => {
  const { state, invitation, profile } = await inspectToken(req.params.token);
  if (state !== 'ok') {
    const [title, message] = MESSAGES[state];
    return res.status(state === 'unknown' ? 404 : 410).json({ state, title, message });
  }
  res.json({
    state,
    email: invitation.email,
    role: invitation.role,
    roleLabel: roleLabel(invitation.role),
    expiresAt: invitation.expires_at,
    passwordMode,
    profile,
  });
});

invitationsRouter.post('/:token/accept', limiter, async (req, res) => {
  const body = parse(
    z.object({ password: z.string().min(1, 'Mot de passe requis.').max(256), passwordConfirm: z.string().max(256).optional() }),
    req.body,
  );
  const { state, invitation, profile } = await inspectToken(req.params.token);
  if (state !== 'ok') {
    const [title, message] = MESSAGES[state];
    throw new HttpError(410, message, { state, title });
  }

  let passwordHash = null;
  if (passwordMode === 'create') {
    const policy = checkPasswordPolicy(body.password);
    if (policy) throw badRequest(policy);
    if (body.password !== body.passwordConfirm) throw badRequest('Les deux mots de passe ne correspondent pas.');
    passwordHash = await hashPassword(body.password);
  } else {
    const ok = await verifyPassword(invitation.email, body.password);
    if (!ok) {
      await audit(req, 'Échec d’activation (mot de passe HPO Mail incorrect)', {
        actor: { label: profile.fullName },
        target: invitation.email,
      });
      throw badRequest('Mot de passe HPO Mail incorrect.');
    }
  }

  const user = await tx(async (c) => {
    // Verrouille l'invitation : un lien ne sert qu'une fois, même en cas de double clic
    const { rows } = await c.query(
      `SELECT * FROM invitations WHERE token_hash = $1 AND status = 'pending' AND expires_at > now() FOR UPDATE`,
      [sha256(req.params.token)],
    );
    if (!rows[0]) throw new HttpError(410, MESSAGES.used[1], { state: 'used', title: MESSAGES.used[0] });

    const existing = await c.query('SELECT id FROM users WHERE email = $1', [invitation.email]);
    if (existing.rows[0]) throw conflict('Un compte HPO Visio existe déjà pour cette adresse. Connectez-vous.');

    const u = await c.query(
      `INSERT INTO users (email, full_name, department, job_title, site, company, role, password_hash, last_login_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now()) RETURNING *`,
      [invitation.email, profile.fullName, profile.department, profile.jobTitle, profile.site, profile.company, invitation.role, passwordHash],
    );
    await c.query(`UPDATE invitations SET status = 'accepted', accepted_at = now(), user_id = $2 WHERE id = $1`, [
      invitation.id,
      u.rows[0].id,
    ]);
    return u.rows[0];
  });

  await audit(req, 'Compte activé par invitation', { actor: user, details: { role: user.role } });
  setSessionCookie(res, user);
  res.status(201).json({ user: publicUser(user) });
});
