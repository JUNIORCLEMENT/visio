import express, { Router } from 'express';
import fs from 'node:fs/promises';
import { z } from 'zod';
import { config } from '../config.js';
import { one, pool, query } from '../db.js';
import { badRequest, conflict, notFound, parse } from '../errors.js';
import { requireRole } from '../middleware/auth.js';
import { audit } from '../services/audit.js';
import { importDirectoryCsv } from '../services/directory/db-directory.js';
import { directory } from '../services/directory/index.js';
import { createAndSendInvitation, serializeInvitation } from '../services/invitations.js';
import { activeRooms, liveKitStatus } from '../services/livekit.js';
import { mailMode, roleLabel, smtpStatus } from '../services/mailer.js';
import { newMeetingCode, serializeMeeting } from '../services/meetings.js';
import { deleteRecording, findRecording, safeResolve, serializeRecording } from '../services/recordings.js';
import { SETTING_KEYS, getSettings, updateSettings } from '../services/settings.js';

export const adminRouter = Router();
adminRouter.use(requireRole('admin'));

const ROLES = ['admin', 'organizer', 'user'];

// ---------------------------------------------------------------------
// Tableau de bord
// ---------------------------------------------------------------------
adminRouter.get('/stats', async (_req, res) => {
  const [live, lk, smtp, dir, counts] = await Promise.all([
    activeRooms(),
    liveKitStatus(),
    smtpStatus(),
    directory.status().catch((e) => ({ ok: false, error: e.message })),
    one(`SELECT
           (SELECT count(*)::int FROM users) AS users_total,
           (SELECT count(*)::int FROM users WHERE status = 'active') AS users_active,
           (SELECT count(*)::int FROM users WHERE last_login_at > now() - interval '24 hours') AS users_today,
           (SELECT count(*)::int FROM invitations WHERE status = 'pending' AND expires_at > now()) AS invitations_pending,
           (SELECT count(*)::int FROM audit_logs WHERE action = 'Échec de connexion' AND created_at > now() - interval '24 hours') AS failed_logins_24h,
           (SELECT count(*)::int FROM recordings WHERE started_at > now() - interval '24 hours') AS recordings_24h,
           (SELECT count(*)::int FROM recordings WHERE status = 'failed' AND started_at > now() - interval '7 days') AS recordings_failed_7d`),
  ]);
  // « En cours » = salle réellement ouverte sur LiveKit (source de vérité pour la présence)
  const liveMeetings = await query(
    `SELECT m.*, u.full_name AS organizer_name FROM meetings m LEFT JOIN users u ON u.id = m.organizer_id
      WHERE m.code = ANY($1::text[]) ORDER BY m.started_at NULLS LAST`,
    [[...live.keys()]],
  );
  res.json({
    counts: {
      liveMeetings: live.size,
      liveParticipants: [...live.values()].reduce((a, b) => a + b, 0),
      usersTotal: counts.users_total,
      usersActive: counts.users_active,
      usersToday: counts.users_today,
      invitationsPending: counts.invitations_pending,
      failedLogins24h: counts.failed_logins_24h,
      recordings24h: counts.recordings_24h,
      recordingsFailed7d: counts.recordings_failed_7d,
    },
    services: {
      database: 'ok',
      livekit: lk,
      smtp,
      mailMode,
      directory: { provider: config.directoryProvider, ...dir },
      authProvider: config.authProvider,
    },
    liveMeetings: liveMeetings.map((m) => serializeMeeting(m, { live })),
  });
});

// ---------------------------------------------------------------------
// Utilisateurs
// ---------------------------------------------------------------------
adminRouter.get('/users', async (req, res) => {
  const search = String(req.query.search ?? '').trim().toLowerCase();
  const rows = await query(
    `SELECT id, email, full_name, department, job_title, site, company, role, status, last_login_at, last_login_origin, created_at
       FROM users
      WHERE $1 = '' OR lower(full_name) LIKE '%' || $1 || '%' OR email LIKE '%' || $1 || '%' OR lower(coalesce(department, '')) LIKE '%' || $1 || '%'
      ORDER BY status, full_name
      LIMIT 500`,
    [search],
  );
  res.json({
    users: rows.map((u) => ({
      id: u.id,
      email: u.email,
      fullName: u.full_name,
      department: u.department,
      jobTitle: u.job_title,
      site: u.site,
      company: u.company,
      role: u.role,
      status: u.status,
      lastLoginAt: u.last_login_at,
      lastLoginOrigin: u.last_login_origin,
      createdAt: u.created_at,
    })),
  });
});

adminRouter.patch('/users/:id', async (req, res) => {
  const body = parse(
    z.object({ role: z.enum(ROLES).optional(), status: z.enum(['active', 'disabled']).optional() }),
    req.body,
  );
  const target = await one('SELECT * FROM users WHERE id = $1', [req.params.id]).catch(() => null);
  if (!target) throw notFound('Utilisateur introuvable.');

  const losesAdmin = target.role === 'admin' && ((body.role && body.role !== 'admin') || body.status === 'disabled');
  if (losesAdmin) {
    if (target.id === req.user.id) throw badRequest('Vous ne pouvez pas retirer vos propres droits d’administrateur.');
    const admins = await one(`SELECT count(*)::int AS n FROM users WHERE role = 'admin' AND status = 'active'`);
    if (admins.n <= 1) throw badRequest('Il doit rester au moins un administrateur actif.');
  }

  const updated = await one(
    `UPDATE users SET role = COALESCE($2, role), status = COALESCE($3, status) WHERE id = $1 RETURNING *`,
    [target.id, body.role ?? null, body.status ?? null],
  );
  if (body.role && body.role !== target.role) {
    await audit(req, `Rôle modifié : ${updated.full_name} devient ${roleLabel(body.role).toLowerCase()}`, { target: updated.email });
  }
  if (body.status && body.status !== target.status) {
    await audit(req, body.status === 'disabled' ? `Compte désactivé : ${updated.full_name}` : `Compte réactivé : ${updated.full_name}`, {
      target: updated.email,
    });
  }
  res.json({ ok: true });
});

// ---------------------------------------------------------------------
// Annuaire HPO Mail
// ---------------------------------------------------------------------
adminRouter.get('/directory/status', async (_req, res) => {
  res.json({ provider: config.directoryProvider, ...(await directory.status()) });
});

/** Relit l'annuaire pour tous les comptes (nom, service, fonction, site, filiale). */
adminRouter.post('/directory/sync', async (req, res) => {
  const users = await query('SELECT id, email FROM users');
  let updated = 0;
  const missing = [];
  for (const u of users) {
    const p = await directory.findByEmail(u.email);
    if (!p) {
      missing.push(u.email);
      continue;
    }
    await query(
      `UPDATE users SET full_name = $2, department = $3, job_title = $4, site = $5, company = $6 WHERE id = $1`,
      [u.id, p.fullName, p.department, p.jobTitle, p.site, p.company],
    );
    updated++;
  }
  await audit(req, 'Synchronisation de l’annuaire', { details: { updated, missing: missing.length } });
  res.json({ updated, missing });
});

/** Import CSV de l'annuaire (fournisseur « db » uniquement). Corps : texte CSV brut. */
adminRouter.post('/directory/import', express.text({ type: ['text/csv', 'text/plain'], limit: '5mb' }), async (req, res) => {
  if (config.directoryProvider !== 'db') {
    throw badRequest('L’annuaire est lu en direct dans LDAP : l’import CSV est désactivé.');
  }
  if (typeof req.body !== 'string' || !req.body.trim()) throw badRequest('Fichier CSV vide.');
  let result;
  try {
    result = await importDirectoryCsv(req.body, { deactivateMissing: req.query.full === '1' });
  } catch (err) {
    throw badRequest(err.message);
  }
  await audit(req, 'Import de l’annuaire HPO Mail', { details: { imported: result.imported, skipped: result.skipped.length } });
  res.json(result);
});

// ---------------------------------------------------------------------
// Invitations
// ---------------------------------------------------------------------
adminRouter.get('/invitations', async (_req, res) => {
  const rows = await query(
    `SELECT i.*, u.full_name AS invited_by_name, d.full_name
       FROM invitations i
       LEFT JOIN users u ON u.id = i.invited_by
       LEFT JOIN directory_entries d ON d.email = i.email
      WHERE i.status <> 'replaced'
      ORDER BY i.created_at DESC LIMIT 300`,
  );
  res.json({ invitations: rows.map(serializeInvitation) });
});

const inviteSchema = z.object({
  emails: z.union([z.string(), z.array(z.string())]),
  role: z.enum(ROLES).default('user'),
  ttlHours: z.number().int().min(1).max(720).optional(),
});

adminRouter.post('/invitations', async (req, res) => {
  const body = parse(inviteSchema, req.body);
  const settings = await getSettings();
  const ttlHours = body.ttlHours ?? settings.invitation_default_ttl;
  const raw = Array.isArray(body.emails) ? body.emails.join(',') : body.emails;
  const emails = [...new Set(raw.split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter(Boolean))];
  if (!emails.length) throw badRequest('Saisissez au moins une adresse HPO Mail.');
  if (emails.length > 200) throw badRequest('200 adresses au maximum par envoi.');

  const invalid = emails.filter((e) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
  if (invalid.length) throw badRequest(`Adresse non valide : ${invalid.join(', ')}`, { emails: invalid });

  const outside = emails.filter((e) => !config.mailDomainsOpen && !config.mailDomains.includes(e.split('@')[1]));
  if (outside.length) {
    throw badRequest(`Seules les adresses ${config.mailDomains.map((d) => '@' + d).join(', ')} peuvent être invitées. À retirer : ${outside.join(', ')}`, {
      emails: outside,
    });
  }

  const existing = await query(`SELECT email FROM users WHERE email = ANY($1::text[])`, [emails]);
  if (existing.length) {
    throw conflict(`Ces personnes ont déjà un compte : ${existing.map((u) => u.email).join(', ')}`, {
      emails: existing.map((u) => u.email),
    });
  }

  const profiles = new Map();
  const unknown = [];
  for (const e of emails) {
    const p = await directory.findByEmail(e);
    if (p) profiles.set(e, p);
    else unknown.push(e);
  }
  if (unknown.length) {
    throw badRequest(`Introuvable dans l’annuaire HPO Mail : ${unknown.join(', ')}`, { emails: unknown });
  }

  const results = [];
  for (const email of emails) {
    try {
      const inv = await createAndSendInvitation({ email, role: body.role, ttlHours, invitedBy: req.user.id, profile: profiles.get(email) });
      results.push({ email, ok: true, id: inv.id });
      await audit(req, `Invitation envoyée (${roleLabel(body.role).toLowerCase()})`, { target: email });
    } catch (err) {
      results.push({ email, ok: false, error: err.message });
    }
  }
  const sent = results.filter((r) => r.ok).length;
  res.status(sent ? 201 : 502).json({ sent, results });
});

adminRouter.post('/invitations/:id/resend', async (req, res) => {
  const inv = await one('SELECT * FROM invitations WHERE id = $1', [req.params.id]).catch(() => null);
  if (!inv) throw notFound('Invitation introuvable.');
  if (inv.status === 'accepted') throw badRequest('Cette invitation a déjà été acceptée.');
  const user = await one('SELECT id FROM users WHERE email = $1', [inv.email]);
  if (user) throw conflict('Cette personne a déjà un compte.');
  const profile = await directory.findByEmail(inv.email);
  if (!profile) throw badRequest('Cette adresse n’est plus dans l’annuaire HPO Mail.');
  const settings = await getSettings();
  const fresh = await createAndSendInvitation({
    email: inv.email,
    role: inv.role,
    ttlHours: inv.ttl_hours || settings.invitation_default_ttl,
    invitedBy: req.user.id,
    profile,
  });
  // L'ancienne invitation (expirée ou révoquée) disparaît de la liste
  await query(`UPDATE invitations SET status = 'replaced' WHERE id = $1 AND status <> 'accepted'`, [inv.id]);
  await audit(req, 'Invitation renvoyée', { target: inv.email });
  res.json({ ok: true, id: fresh.id });
});

adminRouter.post('/invitations/:id/revoke', async (req, res) => {
  const inv = await one(`UPDATE invitations SET status = 'revoked' WHERE id = $1 AND status = 'pending' RETURNING *`, [req.params.id]).catch(
    () => null,
  );
  if (!inv) throw badRequest('Seule une invitation en attente peut être révoquée.');
  await audit(req, 'Invitation révoquée', { target: inv.email });
  res.json({ ok: true });
});

// ---------------------------------------------------------------------
// Salles permanentes
// ---------------------------------------------------------------------
const roomSchema = z.object({
  title: z.string().trim().min(1, 'Nom de la salle requis.').max(160),
  department: z.string().trim().max(160).optional().nullable(),
  organizerEmail: z.string().trim().toLowerCase().optional().nullable(),
  allowGuests: z.boolean().optional(),
  recordingAllowed: z.boolean().optional(),
});

async function resolveOrganizer(email) {
  if (!email) return null;
  const u = await one(`SELECT id FROM users WHERE email = $1 AND status = 'active'`, [email]);
  if (!u) throw badRequest(`Aucun compte actif pour ${email}.`);
  return u.id;
}

adminRouter.get('/rooms', async (_req, res) => {
  const live = await activeRooms();
  const rows = await query(
    `SELECT m.*, u.full_name AS organizer_name, u.email AS organizer_email
       FROM meetings m LEFT JOIN users u ON u.id = m.organizer_id
      WHERE m.is_permanent ORDER BY m.title`,
  );
  res.json({ rooms: rows.map((m) => ({ ...serializeMeeting(m, { live }), organizerEmail: m.organizer_email })) });
});

adminRouter.post('/rooms', async (req, res) => {
  const body = parse(roomSchema, req.body);
  const organizerId = await resolveOrganizer(body.organizerEmail);
  const client = await pool.connect();
  try {
    const code = await newMeetingCode(client);
    const { rows } = await client.query(
      `INSERT INTO meetings (code, title, department, organizer_id, is_permanent, allow_guests, waiting_room, recording_allowed)
       VALUES ($1, $2, $3, $4, true, $5, true, $6) RETURNING *`,
      [code, body.title, body.department ?? null, organizerId, body.allowGuests ?? true, body.recordingAllowed ?? false],
    );
    await audit(req, `Salle permanente créée : « ${body.title} »`, { target: code });
    res.status(201).json({ room: serializeMeeting(rows[0]) });
  } finally {
    client.release();
  }
});

adminRouter.patch('/rooms/:id', async (req, res) => {
  const body = parse(roomSchema.partial(), req.body);
  const organizerId = body.organizerEmail !== undefined ? await resolveOrganizer(body.organizerEmail) : undefined;
  const room = await one(
    `UPDATE meetings SET
        title = COALESCE($2, title),
        department = CASE WHEN $3::boolean THEN $4 ELSE department END,
        organizer_id = CASE WHEN $5::boolean THEN $6::uuid ELSE organizer_id END,
        allow_guests = COALESCE($7, allow_guests),
        recording_allowed = COALESCE($8, recording_allowed)
      WHERE id = $1 AND is_permanent RETURNING *`,
    [
      req.params.id,
      body.title ?? null,
      body.department !== undefined,
      body.department ?? null,
      organizerId !== undefined,
      organizerId ?? null,
      body.allowGuests ?? null,
      body.recordingAllowed ?? null,
    ],
  ).catch(() => null);
  if (!room) throw notFound('Salle introuvable.');
  await audit(req, `Salle modifiée : « ${room.title} »`, { target: room.code });
  res.json({ room: serializeMeeting(room) });
});

// ---------------------------------------------------------------------
// Règles de sécurité
// ---------------------------------------------------------------------
adminRouter.get('/settings', async (_req, res) => {
  res.json({ settings: await getSettings() });
});

const settingsSchema = z
  .object({
    allow_guests: z.boolean(),
    guest_waiting_room: z.boolean(),
    admin_2fa: z.boolean(),
    external_2fa: z.boolean(),
    recording_allowed: z.boolean(),
    recording_retention_days: z.number().int().refine((n) => [30, 90, 365].includes(n), 'Durée : 30, 90 ou 365 jours.'),
    invitation_default_ttl: z.number().int().refine((n) => [48, 72, 168].includes(n), 'Validité : 48, 72 ou 168 heures.'),
  })
  .partial();

adminRouter.put('/settings', async (req, res) => {
  const patch = parse(settingsSchema, req.body);
  const before = await getSettings();
  const settings = await updateSettings(patch, req.user.id);
  const changed = Object.keys(patch).filter((k) => k in SETTING_KEYS && before[k] !== settings[k]);
  if (changed.length) {
    await audit(req, 'Règles de sécurité modifiées', { details: Object.fromEntries(changed.map((k) => [k, settings[k]])) });
  }
  res.json({ settings });
});

// ---------------------------------------------------------------------
// Journal d'activité
// ---------------------------------------------------------------------
const logsQuery = (search, limit, offset) =>
  query(
    `SELECT id, created_at, actor_label, action, target, origin, ip
       FROM audit_logs
      WHERE $1 = '' OR lower(actor_label) LIKE '%' || $1 || '%' OR lower(action) LIKE '%' || $1 || '%'
            OR lower(coalesce(target, '')) LIKE '%' || $1 || '%'
      ORDER BY id DESC LIMIT $2 OFFSET $3`,
    [search, limit, offset],
  );

adminRouter.get('/logs', async (req, res) => {
  const search = String(req.query.search ?? '').trim().toLowerCase();
  const limit = Math.min(Number.parseInt(req.query.limit ?? '100', 10) || 100, 500);
  const offset = Math.max(Number.parseInt(req.query.offset ?? '0', 10) || 0, 0);
  const rows = await logsQuery(search, limit, offset);
  res.json({
    logs: rows.map((r) => ({
      id: Number(r.id),
      createdAt: r.created_at,
      actor: r.actor_label,
      action: r.action,
      target: r.target,
      origin: r.origin,
      ip: r.ip,
    })),
  });
});

adminRouter.get('/logs.csv', async (req, res) => {
  const rows = await logsQuery('', 10_000, 0);
  const cell = (v) => {
    const s = String(v ?? '');
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = ['Date;Utilisateur;Action;Cible;Origine;IP'];
  for (const r of rows) {
    lines.push([new Date(r.created_at).toISOString(), r.actor_label, r.action, r.target, r.origin, r.ip].map(cell).join(';'));
  }
  await audit(req, 'Export du journal (CSV)');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="hpo-visio-journal-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send('﻿' + lines.join('\r\n'));
});

// ---------------------------------------------------------------------
// Enregistrements des réunions et appels (conservés par la DSID)
// ---------------------------------------------------------------------
adminRouter.get('/recordings', async (req, res) => {
  const kind = ['meeting', 'call'].includes(String(req.query.kind)) ? String(req.query.kind) : '';
  const search = String(req.query.search ?? '').trim().toLowerCase();
  const rows = await query(
    `SELECT * FROM recordings
      WHERE ($1 = '' OR kind::text = $1)
        AND ($2 = '' OR lower(title) LIKE '%' || $2 || '%' OR room_name LIKE '%' || $2 || '%' OR lower(coalesce(organizer_name, '')) LIKE '%' || $2 || '%')
      ORDER BY started_at DESC LIMIT 500`,
    [kind, search],
  );
  const totals = await one(
    `SELECT count(*)::int AS n, coalesce(sum(size_bytes), 0)::bigint AS bytes,
            count(*) FILTER (WHERE status = 'recording')::int AS active,
            count(*) FILTER (WHERE status = 'failed')::int AS failed
       FROM recordings`,
  );
  const settings = await getSettings();
  res.json({
    recordings: rows.map(serializeRecording),
    totals: { count: totals.n, bytes: Number(totals.bytes), active: totals.active, failed: totals.failed },
    retentionDays: settings.recording_retention_days,
    enabled: settings.recording_allowed,
  });
});

/** Lecture (avec reprise / avance rapide) ou téléchargement (?download=1). */
adminRouter.get('/recordings/:id/file', async (req, res) => {
  const rec = await findRecording(req.params.id);
  if (!rec || rec.status !== 'ready' || !rec.file_path) throw notFound('Enregistrement indisponible.');
  const file = safeResolve(rec.file_path);
  if (!file || !(await fs.stat(file).catch(() => null))) throw notFound('Le fichier de cet enregistrement est introuvable sur le serveur.');
  if (req.query.download === '1') {
    const date = new Date(rec.started_at).toISOString().slice(0, 10);
    const slug = rec.title.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
    await audit(req, `Enregistrement téléchargé : « ${rec.title} »`, { target: rec.room_name });
    return res.download(file, `${date}_${slug || rec.room_name}.mp4`);
  }
  res.sendFile(file, { headers: { 'Content-Type': 'video/mp4', 'Cache-Control': 'private, no-store' } });
});

adminRouter.delete('/recordings/:id', async (req, res) => {
  const rec = await findRecording(req.params.id);
  if (!rec) throw notFound('Enregistrement introuvable.');
  if (rec.status === 'recording') throw badRequest('Cet enregistrement est en cours : attendez la fin de la réunion.');
  await deleteRecording(rec);
  await audit(req, `Enregistrement supprimé : « ${rec.title} »`, { target: rec.room_name });
  res.json({ ok: true });
});
