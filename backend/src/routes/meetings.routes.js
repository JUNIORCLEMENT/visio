import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { one, query, tx } from '../db.js';
import { HttpError, badRequest, forbidden, notFound, parse, unauthorized } from '../errors.js';
import { requireRole, requireUser } from '../middleware/auth.js';
import { audit } from '../services/audit.js';
import { activeRooms, closeRoom, createJoinToken, prepareRoom, publicUrl, removeParticipant } from '../services/livekit.js';
import { meetingInviteEmail, sendMail } from '../services/mailer.js';
import { findMeetingByCode, isHost, newMeetingCode, serializeMeeting } from '../services/meetings.js';
import { notify } from '../services/notifications.js';
import { markMissed } from '../services/scheduler.js';
import { closeOpenSession, ensureOpenSession } from '../services/sessions.js';
import { getSettings } from '../services/settings.js';

export const meetingsRouter = Router();

async function loadMeeting(req) {
  const m = await findMeetingByCode(req.params.code);
  if (!m) throw notFound('Aucune réunion ne correspond à ce code.');
  // Un appel n'est accessible qu'aux deux personnes concernées (et à la DSID)
  if (m.kind === 'call' && req.user && req.user.role !== 'admin' && m.organizer_id !== req.user.id) {
    const invited = await one('SELECT 1 FROM meeting_invitees WHERE meeting_id = $1 AND user_id = $2', [m.id, req.user.id]);
    if (!invited) throw notFound('Aucune réunion ne correspond à ce code.');
    m.isCallee = true;
  }
  return m;
}

function requireHost(req, m) {
  if (!isHost(req.user, m)) throw forbidden('Seul l’organisateur de la réunion (ou un administrateur) peut faire cela.');
}

const recordingEnabled = async () => (await getSettings()).recording_allowed;

// ---------------------------------------------------------------------
// Mes réunions et salles permanentes
// ---------------------------------------------------------------------
meetingsRouter.get('/', requireUser, async (req, res) => {
  const live = await activeRooms();
  const upcoming = await query(
    `SELECT m.*, u.full_name AS organizer_name
       FROM meetings m LEFT JOIN users u ON u.id = m.organizer_id
      WHERE NOT m.is_permanent AND m.kind = 'meeting'
        AND m.status <> 'ended'
        AND (m.organizer_id = $1 OR EXISTS (SELECT 1 FROM meeting_invitees i WHERE i.meeting_id = m.id AND i.user_id = $1))
        AND (m.scheduled_end IS NULL OR m.scheduled_end > now() - interval '2 hours')
      ORDER BY m.scheduled_start NULLS FIRST, m.created_at DESC
      LIMIT 50`,
    [req.user.id],
  );
  const rooms = await query(
    `SELECT m.*, u.full_name AS organizer_name
       FROM meetings m LEFT JOIN users u ON u.id = m.organizer_id
      WHERE m.is_permanent ORDER BY m.title`,
  );
  res.json({
    upcoming: upcoming.map((m) => serializeMeeting(m, { live, user: req.user })),
    rooms: rooms.map((m) => serializeMeeting(m, { live, user: req.user })),
  });
});

const createSchema = z.object({
  title: z.string().trim().min(1, 'Donnez un titre à la réunion.').max(160),
  description: z.string().trim().max(2000).optional().nullable(),
  scheduledStart: z.iso.datetime({ offset: true, error: 'Date de début invalide.' }).optional().nullable(),
  durationMinutes: z.number().int().min(5).max(24 * 60).optional().nullable(),
  allowGuests: z.boolean().optional(),
  waitingRoom: z.boolean().optional(),
  inviteeEmails: z.array(z.string().trim().toLowerCase()).max(300).optional(),
});

meetingsRouter.post('/', requireUser, async (req, res) => {
  const body = parse(createSchema, req.body);
  const settings = await getSettings();
  const start = body.scheduledStart ? new Date(body.scheduledStart) : null;
  const end = start && body.durationMinutes ? new Date(start.getTime() + body.durationMinutes * 60_000) : null;
  const allowGuests = settings.allow_guests && (body.allowGuests ?? true);
  const waitingRoom = settings.guest_waiting_room ? true : (body.waitingRoom ?? true);

  const emails = [...new Set(body.inviteeEmails ?? [])].filter((e) => e && e !== req.user.email);
  const invitees = emails.length
    ? await query(`SELECT id, email, full_name FROM users WHERE email = ANY($1::text[]) AND status = 'active'`, [emails])
    : [];
  const notFoundEmails = emails.filter((e) => !invitees.some((u) => u.email === e));

  const meeting = await tx(async (c) => {
    const code = await newMeetingCode(c);
    const { rows } = await c.query(
      `INSERT INTO meetings (code, title, description, department, organizer_id, scheduled_start, scheduled_end,
                             allow_guests, waiting_room, recording_allowed)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [code, body.title, body.description ?? null, req.user.department, req.user.id, start, end, allowGuests, waitingRoom, settings.recording_allowed],
    );
    for (const u of invitees) {
      await c.query('INSERT INTO meeting_invitees (meeting_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [rows[0].id, u.id]);
    }
    return rows[0];
  });

  // Convocations : Activité + e-mail HPO Mail (sans bloquer la création en cas d'échec)
  const url = `${config.appUrl}/reunion/${meeting.code}`;
  const whenText = meeting.scheduled_start
    ? new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: process.env.TZ || 'Africa/Libreville' }).format(new Date(meeting.scheduled_start))
    : 'maintenant';
  await notify(
    invitees.map((u) => u.id),
    {
      type: 'meeting_invite',
      title: `${req.user.full_name} vous convie à « ${meeting.title} »`,
      body: `${whenText.charAt(0).toUpperCase() + whenText.slice(1)} · code ${meeting.code}`,
      link: `/reunion/${meeting.code}`,
      meetingId: meeting.id,
    },
  );
  await Promise.allSettled(
    invitees.map((u) =>
      sendMail({
        to: u.email,
        ...meetingInviteEmail({
          firstName: u.full_name.split(' ')[0],
          organizer: req.user.full_name,
          title: meeting.title,
          start: meeting.scheduled_start,
          code: meeting.code,
          url,
        }),
      }),
    ),
  );
  await audit(req, 'Réunion créée', { target: meeting.code, details: { title: meeting.title, invitees: invitees.length } });
  res.status(201).json({
    meeting: serializeMeeting({ ...meeting, organizer_name: req.user.full_name }, { user: req.user }),
    notFound: notFoundEmails,
  });
});

meetingsRouter.get('/:code', requireUser, async (req, res) => {
  const m = await loadMeeting(req);
  const live = await activeRooms();
  res.json({
    meeting: { ...serializeMeeting(m, { live, user: req.user }), recording: await recordingEnabled() },
    guestLink: `${config.appUrl}/rejoindre/${m.code}`,
  });
});

// ---------------------------------------------------------------------
// Rejoindre : délivre le jeton LiveKit
// ---------------------------------------------------------------------
meetingsRouter.post('/:code/join', requireUser, async (req, res) => {
  const m = await loadMeeting(req);
  const host = isHost(req.user, m);
  if (m.kind === 'call' && m.status === 'ended') throw new HttpError(410, 'Cet appel est terminé.');
  if (m.status === 'ended' && !host) {
    throw new HttpError(410, 'Cette réunion est terminée.');
  }
  // Ouvre la salle (et lance l'enregistrement automatique) avant la première connexion
  const record = await recordingEnabled();
  await prepareRoom(m, { record });
  await ensureOpenSession(m.id);
  // Appel : la personne appelée décroche (arrête la sonnerie et le compte à rebours « manqué »)
  if (m.kind === 'call' && m.isCallee) {
    await query(`UPDATE meetings SET answered_at = COALESCE(answered_at, now()), ring_until = NULL WHERE id = $1`, [m.id]);
    await query(`UPDATE notifications SET read_at = now() WHERE meeting_id = $1 AND user_id = $2 AND type = 'incoming_call' AND read_at IS NULL`, [m.id, req.user.id]);
  }
  await query(
    `UPDATE meetings SET status = 'live', started_at = COALESCE(CASE WHEN status = 'live' THEN started_at END, now()), ended_at = NULL
      WHERE id = $1`,
    [m.id],
  );
  const token = await createJoinToken({
    identity: `u:${req.user.id}`,
    name: req.user.full_name,
    room: m.code,
    roomAdmin: host,
    metadata: { kind: host ? 'host' : 'member', userId: req.user.id },
  });
  await audit(req, `A rejoint « ${m.title} »`, { target: m.code });
  res.json({ livekit: { url: publicUrl(), token }, meeting: { ...serializeMeeting(m, { user: req.user }), recording: record } });
});

meetingsRouter.post('/:code/end', requireUser, async (req, res) => {
  const m = await loadMeeting(req);
  // Appel : chacune des deux personnes peut raccrocher pour les deux
  if (!(m.kind === 'call' && m.isCallee)) requireHost(req, m);
  if (m.kind === 'call' && !m.answered_at && m.status !== 'ended') {
    await tx((c) => markMissed(c, m));
  }
  await closeRoom(m.code);
  await closeOpenSession(m.id);
  await query(
    `UPDATE meetings SET status = CASE WHEN is_permanent THEN 'scheduled'::meeting_status ELSE 'ended'::meeting_status END,
            ended_at = now() WHERE id = $1`,
    [m.id],
  );
  await query(`UPDATE guest_requests SET status = 'denied', decided_at = now() WHERE meeting_id = $1 AND status = 'waiting'`, [m.id]);
  await audit(req, `Réunion terminée : « ${m.title} »`, { target: m.code });
  res.json({ ok: true });
});

// ---------------------------------------------------------------------
// Salle d'attente (vue de l'organisateur)
// ---------------------------------------------------------------------
meetingsRouter.get('/:code/guests', requireUser, async (req, res) => {
  const m = await loadMeeting(req);
  requireHost(req, m);
  const rows = await query(
    `SELECT id, display_name, organization, status, created_at FROM guest_requests
      WHERE meeting_id = $1 AND (status = 'waiting' OR (status = 'admitted' AND created_at > now() - interval '12 hours'))
      ORDER BY created_at`,
    [m.id],
  );
  res.json({
    guests: rows.map((g) => ({
      id: g.id,
      displayName: g.display_name,
      organization: g.organization,
      status: g.status,
      createdAt: g.created_at,
    })),
  });
});

meetingsRouter.post('/:code/guests/:id/:decision', requireUser, async (req, res) => {
  const m = await loadMeeting(req);
  requireHost(req, m);
  const decision = req.params.decision;
  if (!['admit', 'deny', 'remove'].includes(decision)) throw notFound();
  const g = await one('SELECT * FROM guest_requests WHERE id = $1 AND meeting_id = $2', [req.params.id, m.id]).catch(() => null);
  if (!g) throw notFound('Demande introuvable.');

  if (decision === 'admit') {
    if (g.status !== 'waiting') throw badRequest('Cette personne n’est plus en attente.');
    await query(`UPDATE guest_requests SET status = 'admitted', decided_by = $2, decided_at = now() WHERE id = $1`, [g.id, req.user.id]);
    await audit(req, `Invité admis dans « ${m.title} »`, { target: g.display_name });
  } else {
    await query(`UPDATE guest_requests SET status = 'denied', decided_by = $2, decided_at = now() WHERE id = $1`, [g.id, req.user.id]);
    if (decision === 'remove') await removeParticipant(m.code, `g:${g.id}`);
    await audit(req, decision === 'remove' ? `Invité retiré de « ${m.title} »` : `Invité refusé dans « ${m.title} »`, {
      target: g.display_name,
    });
  }
  res.json({ ok: true });
});

// ---------------------------------------------------------------------
// Discussion de la réunion (collaborateurs et invités admis)
// ---------------------------------------------------------------------
function chatIdentity(req, m) {
  if (req.user) return { userId: req.user.id, guestId: null, name: req.user.full_name };
  if (req.guest && req.guest.meetingId === m.id) return { userId: null, guestId: req.guest.id, name: `${req.guest.full_name} (invité)` };
  throw unauthorized();
}

meetingsRouter.get('/:code/messages', async (req, res) => {
  const m = await loadMeeting(req);
  chatIdentity(req, m);
  const after = Number.parseInt(req.query.after ?? '0', 10) || 0;
  const rows = await query(
    `SELECT id, user_id, guest_id, sender_name, body, created_at FROM chat_messages
      WHERE meeting_id = $1 AND id > $2 ORDER BY id DESC LIMIT 200`,
    [m.id, after],
  );
  res.json({ messages: rows.reverse().map(serializeMessage) });
});

meetingsRouter.post('/:code/messages', async (req, res) => {
  const m = await loadMeeting(req);
  const who = chatIdentity(req, m);
  const { body } = parse(z.object({ body: z.string().trim().min(1, 'Message vide.').max(2000) }), req.body);
  const row = await one(
    `INSERT INTO chat_messages (meeting_id, user_id, guest_id, sender_name, body)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [m.id, who.userId, who.guestId, who.name, body],
  );
  res.status(201).json({ message: serializeMessage(row) });
});

function serializeMessage(r) {
  return {
    id: Number(r.id),
    senderId: r.user_id ? `u:${r.user_id}` : `g:${r.guest_id}`,
    senderName: r.sender_name,
    body: r.body,
    createdAt: r.created_at,
  };
}
