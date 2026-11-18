import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { one } from '../db.js';
import { HttpError, forbidden, notFound, parse } from '../errors.js';
import { signGuestToken } from '../middleware/auth.js';
import { audit } from '../services/audit.js';
import { createJoinToken, publicUrl } from '../services/livekit.js';
import { findMeetingByCode } from '../services/meetings.js';
import { getSettings } from '../services/settings.js';
import { randomToken, safeEqualHex, sha256 } from '../services/tokens.js';

/**
 * Invités externes : rejoindre une réunion par lien, sans compte.
 * Parcours : demande → salle d'attente → admission par l'organisateur → jeton LiveKit.
 */
export const publicRouter = Router();

const limiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Trop de demandes. Patientez quelques minutes.' },
});

async function guestPolicy(m) {
  const s = await getSettings();
  return {
    guestsAllowed: s.allow_guests && m.allow_guests,
    waitingRoom: s.guest_waiting_room || m.waiting_room,
  };
}

publicRouter.get('/meetings/:code', async (req, res) => {
  const m = await findMeetingByCode(req.params.code);
  if (!m) throw notFound('Aucune réunion ne correspond à ce lien.');
  const policy = await guestPolicy(m);
  if (m.kind === 'call') throw notFound('Aucune réunion ne correspond à ce lien.');
  res.json({
    code: m.code,
    title: m.title,
    organizerName: m.organizer_name,
    status: m.status,
    scheduledStart: m.scheduled_start,
    recording: (await getSettings()).recording_allowed,
    ...policy,
  });
});

publicRouter.post('/meetings/:code/guests', limiter, async (req, res) => {
  const m = await findMeetingByCode(req.params.code);
  if (!m || m.kind === 'call') throw notFound('Aucune réunion ne correspond à ce lien.');
  const policy = await guestPolicy(m);
  if (!policy.guestsAllowed) throw forbidden('Les invités externes ne sont pas autorisés dans cette réunion.');
  if (m.status === 'ended') throw new HttpError(410, 'Cette réunion est terminée.');

  const body = parse(
    z.object({
      displayName: z.string().trim().min(2, 'Indiquez votre nom complet.').max(80),
      organization: z.string().trim().max(120).optional().nullable(),
    }),
    req.body,
  );
  const secret = randomToken(24);
  const g = await one(
    `INSERT INTO guest_requests (meeting_id, display_name, organization, secret_hash, status, decided_at)
     VALUES ($1, $2, $3, $4, $5, CASE WHEN $5 = 'admitted'::guest_status THEN now() END) RETURNING id, status`,
    [m.id, body.displayName, body.organization || null, sha256(secret), policy.waitingRoom ? 'waiting' : 'admitted'],
  );
  await audit(req, policy.waitingRoom ? `Invité en salle d’attente de « ${m.title} »` : `Invité entré dans « ${m.title} »`, {
    actor: { label: `${body.displayName} (invité)` },
    target: m.code,
  });
  res.status(201).json({ requestId: g.id, secret, status: g.status });
});

/** Le navigateur de l'invité interroge cette adresse toutes les 3 s pendant l'attente. */
publicRouter.get('/guests/:id', async (req, res) => {
  const secret = req.get('x-guest-secret') || '';
  const g = await one(
    `SELECT g.*, m.code, m.title, m.status AS meeting_status
       FROM guest_requests g JOIN meetings m ON m.id = g.meeting_id WHERE g.id = $1`,
    [req.params.id],
  ).catch(() => null);
  if (!g || !safeEqualHex(g.secret_hash, sha256(secret))) throw notFound('Demande introuvable.');

  if (g.status !== 'admitted') {
    return res.json({ status: g.meeting_status === 'ended' && g.status === 'waiting' ? 'denied' : g.status });
  }
  const token = await createJoinToken({
    identity: `g:${g.id}`,
    name: `${g.display_name} (invité)`,
    room: g.code,
    metadata: { kind: 'guest', organization: g.organization },
  });
  res.json({
    status: 'admitted',
    guestToken: signGuestToken({ guestId: g.id, meetingId: g.meeting_id, name: g.display_name }),
    livekit: { url: publicUrl(), token },
    meeting: { code: g.code, title: g.title },
    recording: (await getSettings()).recording_allowed,
  });
});
