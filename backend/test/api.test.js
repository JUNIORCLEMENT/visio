/**
 * Tests d'intégration de l'API (base PostgreSQL réelle, LiveKit facultatif).
 *   TEST_DATABASE_URL=postgres://.../hpo_visio_test npm test
 * ⚠ La base de test est VIDÉE au début : n'utilisez jamais la base de production.
 */
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://postgres@localhost:5432/hpo_visio_test';
process.env.SESSION_SECRET = 'test-secret-'.padEnd(48, 'x');
process.env.APP_URL = 'http://localhost:4200';
process.env.HPO_MAIL_DOMAINS = 'hpo-groupe.com';
process.env.AUTH_PROVIDER = 'local';
process.env.DIRECTORY_PROVIDER = 'db';
process.env.SMTP_HOST = '';
process.env.LIVEKIT_API_URL = 'http://127.0.0.1:59999';
process.env.TRUST_PROXY = 'false';

const { createApp } = await import('../src/app.js');
const { pool } = await import('../src/db.js');
const { outbox } = await import('../src/services/mailer.js');
const { ensureAdmin } = await import('../src/bootstrap.js');

const ADMIN = { email: 'admin@hpo-groupe.com', password: 'AdminTest2026' };
let server;
let base;

/** Petit client HTTP avec gestion du cookie de session. */
function client() {
  let cookie = '';
  return async (method, path, body, headers = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: {
        ...(body !== undefined && typeof body !== 'string' ? { 'content-type': 'application/json' } : {}),
        ...(cookie ? { cookie } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
    const set = res.headers.getSetCookie?.() ?? [];
    for (const c of set) {
      const [pair] = c.split(';');
      cookie = pair.endsWith('=') ? '' : pair;
    }
    const type = res.headers.get('content-type') || '';
    const data = type.includes('json') ? await res.json() : await res.text();
    return { status: res.status, data, headers: res.headers };
  };
}

const lastMailTo = (to) => [...outbox].reverse().find((m) => m.to === to);
const linkToken = (mail, kind) => mail.text.match(new RegExp(`/${kind}/([A-Za-z0-9_-]+)`))[1];

before(async () => {
  await pool.query(`TRUNCATE users, invitations, password_resets, login_challenges, meeting_invitees,
                    guest_requests, chat_messages, audit_logs RESTART IDENTITY CASCADE`);
  // TRUNCATE … CASCADE vide aussi « meetings » (clé étrangère vers users) : on recharge la démo
  const demo = await import('node:fs/promises').then((fs) => fs.readFile(new URL('../../database/init/03-demo.sql', import.meta.url), 'utf8'));
  await pool.query(demo);
  // (TRUNCATE … CASCADE vide aussi « settings », liée à users)
  await pool.query(`INSERT INTO settings (key, value) VALUES
      ('admin_2fa', 'true'), ('external_2fa', 'false'), ('recording_allowed', 'true'), ('allow_guests', 'true'),
      ('guest_waiting_room', 'true'), ('recording_retention_days', '90'), ('invitation_default_ttl', '72')
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`);
  await ensureAdmin({ email: ADMIN.email, name: 'Admin Test', password: ADMIN.password }, () => {});
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server?.close();
  await pool.end();
});

describe('HPO Visio — parcours complet', () => {
  const admin = client();
  const rodrigue = client();
  const anon = client();
  let rodrigueToken;
  let meetingCode;

  test('santé et configuration publique', async () => {
    assert.equal((await anon('GET', '/api/health')).data.status, 'ok');
    const cfg = await anon('GET', '/api/auth/config');
    assert.equal(cfg.data.passwordMode, 'create');
    assert.equal((await anon('GET', '/api/auth/me')).status, 401);
  });

  test('connexion administrateur avec code à 6 chiffres', async () => {
    const bad = await admin('POST', '/api/auth/login', { email: ADMIN.email, password: 'mauvais' });
    assert.equal(bad.status, 401);

    const r = await admin('POST', '/api/auth/login', { email: 'ADMIN@hpo-groupe.com ', password: ADMIN.password });
    assert.equal(r.status, 200);
    assert.equal(r.data.mfaRequired, true);
    const code = lastMailTo(ADMIN.email).subject.match(/(\d{6})/)[1];

    const wrong = await admin('POST', '/api/auth/verify', { challengeId: r.data.challengeId, code: code === '000000' ? '111111' : '000000' });
    assert.equal(wrong.status, 400);
    const ok = await admin('POST', '/api/auth/verify', { challengeId: r.data.challengeId, code });
    assert.equal(ok.status, 200);
    assert.equal(ok.data.user.role, 'admin');
    const reuse = await admin('POST', '/api/auth/verify', { challengeId: r.data.challengeId, code });
    assert.equal(reuse.status, 400, 'un code ne sert qu’une fois');
    assert.equal((await admin('GET', '/api/auth/me')).data.user.email, ADMIN.email);
  });

  test('un non-administrateur ne voit pas l’admin', async () => {
    assert.equal((await anon('GET', '/api/admin/users')).status, 401);
  });

  test('invitations : contrôles avant envoi', async () => {
    let r = await admin('POST', '/api/admin/invitations', { emails: 'x@gmail.com', role: 'user' });
    assert.equal(r.status, 400);
    assert.match(r.data.error, /Seules les adresses/);

    r = await admin('POST', '/api/admin/invitations', { emails: 'inconnu@hpo-groupe.com', role: 'user' });
    assert.equal(r.status, 400);
    assert.match(r.data.error, /Introuvable dans l’annuaire/);

    r = await admin('POST', '/api/admin/invitations', { emails: ADMIN.email, role: 'user' });
    assert.equal(r.status, 409);
  });

  test('invitations : envoi, renvoi et révocation', async () => {
    const r = await admin('POST', '/api/admin/invitations', {
      emails: 'rodrigue.mouketou@hpo-groupe.com; sandrine.mboumba@hpo-groupe.com',
      role: 'user',
      ttlHours: 72,
    });
    assert.equal(r.status, 201);
    assert.equal(r.data.sent, 2);

    const mail = lastMailTo('rodrigue.mouketou@hpo-groupe.com');
    assert.equal(mail.subject, 'Activez votre compte HPO Visio');
    rodrigueToken = linkToken(mail, 'invitation');

    const list = await admin('GET', '/api/admin/invitations');
    const sandrine = list.data.invitations.find((i) => i.email === 'sandrine.mboumba@hpo-groupe.com');
    assert.equal(sandrine.status, 'pending');
    const oldSandrineToken = linkToken(lastMailTo(sandrine.email), 'invitation');

    const resend = await admin('POST', `/api/admin/invitations/${sandrine.id}/resend`);
    assert.equal(resend.status, 200);
    const replaced = await anon('GET', `/api/invitations/${oldSandrineToken}`);
    assert.equal(replaced.status, 410);
    assert.equal(replaced.data.state, 'replaced');

    const revoke = await admin('POST', `/api/admin/invitations/${resend.data.id}/revoke`);
    assert.equal(revoke.status, 200);
    const newToken = linkToken(lastMailTo(sandrine.email), 'invitation');
    assert.equal((await anon('GET', `/api/invitations/${newToken}`)).data.state, 'revoked');
  });

  test('activation du compte depuis le lien HPO Mail', async () => {
    const info = await anon('GET', `/api/invitations/${rodrigueToken}`);
    assert.equal(info.status, 200);
    assert.equal(info.data.profile.fullName, 'Rodrigue Mouketou');
    assert.equal(info.data.profile.site, 'Moanda');
    assert.equal(info.data.passwordMode, 'create');

    let r = await rodrigue('POST', `/api/invitations/${rodrigueToken}/accept`, { password: 'court', passwordConfirm: 'court' });
    assert.equal(r.status, 400);
    r = await rodrigue('POST', `/api/invitations/${rodrigueToken}/accept`, { password: 'Moanda2026ok', passwordConfirm: 'Moanda2026ko' });
    assert.equal(r.status, 400);
    r = await rodrigue('POST', `/api/invitations/${rodrigueToken}/accept`, { password: 'Moanda2026ok', passwordConfirm: 'Moanda2026ok' });
    assert.equal(r.status, 201);
    assert.equal(r.data.user.role, 'user');
    assert.equal((await rodrigue('GET', '/api/auth/me')).data.user.fullName, 'Rodrigue Mouketou');

    const again = await anon('GET', `/api/invitations/${rodrigueToken}`);
    assert.equal(again.data.state, 'used');
    assert.equal((await anon('GET', '/api/invitations/n-importe-quoi-mais-assez-long')).status, 404);
  });

  test('rôles : utilisateur → organisateur, garde-fous admin', async () => {
    assert.equal((await rodrigue('POST', '/api/meetings', { title: 'Test' })).status, 403);
    const users = (await admin('GET', '/api/admin/users?search=mouketou')).data.users;
    assert.equal(users.length, 1);
    assert.equal((await admin('PATCH', `/api/admin/users/${users[0].id}`, { role: 'organizer' })).status, 200);

    const me = (await admin('GET', '/api/auth/me')).data.user;
    const self = await admin('PATCH', `/api/admin/users/${me.id}`, { role: 'user' });
    assert.equal(self.status, 400);
  });

  test('réunion : création, jeton LiveKit, salle d’attente, discussion', async () => {
    const created = await rodrigue('POST', '/api/meetings', {
      title: 'Point hebdo – Exploitation Moanda',
      scheduledStart: new Date(Date.now() + 3600_000).toISOString(),
      durationMinutes: 45,
      inviteeEmails: [ADMIN.email, 'personne@hpo-groupe.com'],
    });
    assert.equal(created.status, 201);
    meetingCode = created.data.meeting.code;
    assert.match(meetingCode, /^hpo-\d{3}-\d{3}$/);
    assert.deepEqual(created.data.notFound, ['personne@hpo-groupe.com']);
    assert.ok(lastMailTo(ADMIN.email).subject.startsWith('Réunion :'));

    const mine = await admin('GET', '/api/meetings');
    assert.ok(mine.data.upcoming.some((m) => m.code === meetingCode));
    assert.ok(mine.data.rooms.length >= 3, 'salles permanentes de démonstration');

    const join = await rodrigue('POST', `/api/meetings/${meetingCode}/join`);
    assert.equal(join.status, 200);
    assert.equal(join.data.livekit.token.split('.').length, 3);
    const grant = JSON.parse(Buffer.from(join.data.livekit.token.split('.')[1], 'base64url').toString());
    assert.equal(grant.video.room, meetingCode);
    assert.equal(grant.video.roomAdmin, true);

    // Invité externe
    const pub = await anon('GET', `/api/public/meetings/${meetingCode}`);
    assert.equal(pub.data.guestsAllowed, true);
    assert.equal(pub.data.waitingRoom, true);
    const req = await anon('POST', `/api/public/meetings/${meetingCode}/guests`, { displayName: 'Jean Moussavou', organization: 'Partenaire' });
    assert.equal(req.status, 201);
    assert.equal(req.data.status, 'waiting');
    const poll = (secret = req.data.secret) => anon('GET', `/api/public/guests/${req.data.requestId}`, undefined, { 'x-guest-secret': secret });
    assert.equal((await poll()).data.status, 'waiting');
    assert.equal((await poll('mauvais-secret')).status, 404);

    const waiting = await rodrigue('GET', `/api/meetings/${meetingCode}/guests`);
    assert.equal(waiting.data.guests.length, 1);
    assert.equal((await rodrigue('POST', `/api/meetings/${meetingCode}/guests/${req.data.requestId}/admit`)).status, 200);
    const admitted = await poll();
    assert.equal(admitted.data.status, 'admitted');
    assert.ok(admitted.data.livekit.token);

    const gmsg = await anon('POST', `/api/meetings/${meetingCode}/messages`, { body: 'Bonjour à tous' }, {
      authorization: `Bearer ${admitted.data.guestToken}`,
    });
    assert.equal(gmsg.status, 201);
    assert.equal((await anon('POST', `/api/meetings/${meetingCode}/messages`, { body: 'sans jeton' })).status, 401);
    await rodrigue('POST', `/api/meetings/${meetingCode}/messages`, { body: 'Bienvenue Jean' });
    const msgs = await rodrigue('GET', `/api/meetings/${meetingCode}/messages`);
    assert.deepEqual(msgs.data.messages.map((m) => m.body), ['Bonjour à tous', 'Bienvenue Jean']);
    assert.equal(msgs.data.messages[0].senderName, 'Jean Moussavou (invité)');
  });

  test('règles de sécurité : invités interdits', async () => {
    const r = await admin('PUT', '/api/admin/settings', { allow_guests: false });
    assert.equal(r.data.settings.allow_guests, false);
    await new Promise((res) => setTimeout(res, 50));
    const refused = await anon('POST', `/api/public/meetings/${meetingCode}/guests`, { displayName: 'Autre invité' });
    // Le cache des réglages est vidé à la mise à jour
    assert.equal(refused.status, 403);
    await admin('PUT', '/api/admin/settings', { allow_guests: true });
    assert.equal((await admin('PUT', '/api/admin/settings', { recording_retention_days: 12 })).status, 400);
  });

  test('fin de réunion', async () => {
    assert.equal((await admin('POST', `/api/meetings/${meetingCode}/end`)).status, 200);
    const info = await rodrigue('GET', `/api/meetings/${meetingCode}`);
    assert.equal(info.data.meeting.status, 'ended');
  });

  test('annuaire : import CSV et synchronisation', async () => {
    const csv = 'Email;Nom complet;Service;Fonction;Site;Filiale\n' +
      'nadia.obame@hpo-groupe.com;Nadia Obame;Logistique;Magasinière;Moanda;SGTP\n' +
      'mauvaise-adresse;X;;;;\n' +
      'rodrigue.mouketou@hpo-groupe.com;Rodrigue Mouketou;Exploitation;Chef de site;Moanda;SGTP-MINE\n';
    const r = await admin('POST', '/api/admin/directory/import', csv, { 'content-type': 'text/csv' });
    assert.equal(r.status, 200);
    assert.equal(r.data.imported, 2);
    assert.equal(r.data.skipped.length, 1);
    const sync = await admin('POST', '/api/admin/directory/sync');
    assert.equal(sync.status, 200);
    const u = (await admin('GET', '/api/admin/users?search=mouketou')).data.users[0];
    assert.equal(u.jobTitle, 'Chef de site');
  });

  test('journal et export CSV', async () => {
    const logs = await admin('GET', '/api/admin/logs');
    const actions = logs.data.logs.map((l) => l.action);
    assert.ok(actions.some((a) => a.startsWith('Invitation envoyée')));
    assert.ok(actions.includes('Compte activé par invitation'));
    assert.ok(actions.includes('Connexion avec double authentification'));
    const csv = await admin('GET', '/api/admin/logs.csv');
    assert.match(csv.headers.get('content-type'), /text\/csv/);
    assert.match(csv.data, /Date;Utilisateur;Action/);
    const stats = await admin('GET', '/api/admin/stats');
    assert.equal(stats.status, 200);
    assert.equal(stats.data.services.livekit, 'down');
    assert.equal(stats.data.counts.usersTotal, 2);
  });

  test('mot de passe oublié (mode local)', async () => {
    await anon('POST', '/api/auth/forgot', { email: 'rodrigue.mouketou@hpo-groupe.com' });
    const token = linkToken(lastMailTo('rodrigue.mouketou@hpo-groupe.com'), 'reinitialiser');
    assert.equal((await anon('POST', '/api/auth/reset', { token, password: 'faible' })).status, 400);
    assert.equal((await anon('POST', '/api/auth/reset', { token, password: 'NouveauMdp2026' })).status, 200);
    assert.equal((await anon('POST', '/api/auth/reset', { token, password: 'NouveauMdp2027' })).status, 400);
    const login = await rodrigue('POST', '/api/auth/login', { email: 'rodrigue.mouketou@hpo-groupe.com', password: 'NouveauMdp2026' });
    assert.equal(login.status, 200);
    assert.equal(login.data.user.role, 'organizer');
  });

  test('compte désactivé : session coupée', async () => {
    const id = (await rodrigue('GET', '/api/auth/me')).data.user.id;
    await admin('PATCH', `/api/admin/users/${id}`, { status: 'disabled' });
    assert.equal((await rodrigue('GET', '/api/auth/me')).status, 401);
    const login = await rodrigue('POST', '/api/auth/login', { email: 'rodrigue.mouketou@hpo-groupe.com', password: 'NouveauMdp2026' });
    assert.equal(login.status, 401);
    assert.match(login.data.error, /désactivé/);
  });

  test('blocage après 8 échecs', async () => {
    for (let i = 0; i < 8; i++) await anon('POST', '/api/auth/login', { email: 'cible@hpo-groupe.com', password: 'x' });
    const r = await anon('POST', '/api/auth/login', { email: 'cible@hpo-groupe.com', password: 'x' });
    assert.equal(r.status, 429);
  });

  test('requête venant d’un autre site refusée', async () => {
    const r = await anon('POST', '/api/auth/logout', {}, { origin: 'https://site-malveillant.example' });
    assert.equal(r.status, 403);
  });
});
