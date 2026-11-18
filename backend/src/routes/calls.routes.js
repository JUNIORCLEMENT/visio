import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { one, query, tx } from '../db.js';
import { badRequest, conflict, forbidden, notFound, parse } from '../errors.js';
import { requireUser } from '../middleware/auth.js';
import { audit } from '../services/audit.js';
import { closeRoom } from '../services/livekit.js';
import { findMeetingByCode, newMeetingCode, serializeMeeting } from '../services/meetings.js';
import { notify } from '../services/notifications.js';
import { markMissed } from '../services/scheduler.js';

// ---------------------------------------------------------------------
// Contacts : collègues ayant un compte HPO Visio
// ---------------------------------------------------------------------
export const contactsRouter = Router();
contactsRouter.use(requireUser);

contactsRouter.get('/', async (req, res) => {
  const search = String(req.query.search ?? '').trim().toLowerCase();
  const rows = await query(
    `SELECT id, email, full_name, department, job_title, site, company,
            (last_seen_at > now() - interval '90 seconds') AS online
       FROM users
      WHERE status = 'active' AND id <> $1
        AND ($2 = '' OR lower(full_name) LIKE '%' || $2 || '%' OR email LIKE '%' || $2 || '%'
             OR lower(coalesce(department, '')) LIKE '%' || $2 || '%' OR lower(coalesce(site, '')) LIKE '%' || $2 || '%'
             OR lower(coalesce(company, '')) LIKE '%' || $2 || '%')
      ORDER BY online DESC, full_name
      LIMIT 300`,
    [req.user.id, search],
  );
  res.json({
    contacts: rows.map((u) => ({
      id: u.id,
      email: u.email,
      fullName: u.full_name,
      department: u.department,
      jobTitle: u.job_title,
      site: u.site,
      company: u.company,
      online: !!u.online,
    })),
  });
});

// ---------------------------------------------------------------------
// Appels : une « réunion » à deux, qui sonne chez la personne appelée
// ---------------------------------------------------------------------
export const callsRouter = Router();
callsRouter.use(requireUser);

callsRouter.post('/', async (req, res) => {
  const { userId } = parse(z.object({ userId: z.uuid({ error: 'Personne à appeler invalide.' }) }), req.body);
  if (userId === req.user.id) throw badRequest('Vous ne pouvez pas vous appeler vous-même.');
  const callee = await one(`SELECT id, email, full_name FROM users WHERE id = $1 AND status = 'active'`, [userId]);
  if (!callee) throw notFound('Ce collègue n’a pas de compte actif.');

  const busy = await one(
    `SELECT 1 FROM meetings m JOIN meeting_invitees i ON i.meeting_id = m.id
      WHERE m.kind = 'call' AND i.user_id = $1 AND m.status <> 'ended' AND m.ring_until > now()`,
    [callee.id],
  );
  if (busy) throw conflict(`${callee.full_name} reçoit déjà un appel. Réessayez dans un instant.`);

  const meeting = await tx(async (c) => {
    const code = await newMeetingCode(c);
    const { rows } = await c.query(
      `INSERT INTO meetings (code, title, department, organizer_id, kind, allow_guests, waiting_room, ring_until)
       VALUES ($1, $2, $3, $4, 'call', false, true, now() + make_interval(secs => $5)) RETURNING *`,
      [code, `Appel : ${req.user.full_name} ↔ ${callee.full_name}`, req.user.department, req.user.id, config.callRingSeconds],
    );
    await c.query('INSERT INTO meeting_invitees (meeting_id, user_id) VALUES ($1, $2)', [rows[0].id, callee.id]);
    await notify(
      [callee.id],
      { type: 'incoming_call', title: `${req.user.full_name} vous appelle`, body: req.user.department, link: `/reunion/${code}`, meetingId: rows[0].id },
      c,
    );
    return rows[0];
  });
  await audit(req, `Appel vers ${callee.full_name}`, { target: meeting.code });
  res.status(201).json({ meeting: serializeMeeting({ ...meeting, organizer_name: req.user.full_name }, { user: req.user }) });
});

async function loadCall(req) {
  const m = await findMeetingByCode(req.params.code);
  if (!m || m.kind !== 'call') throw notFound('Appel introuvable.');
  const invited = await one('SELECT 1 FROM meeting_invitees WHERE meeting_id = $1 AND user_id = $2', [m.id, req.user.id]);
  return { m, isCallee: !!invited, isCaller: m.organizer_id === req.user.id };
}

/** La personne appelée refuse. */
callsRouter.post('/:code/decline', async (req, res) => {
  const { m, isCallee } = await loadCall(req);
  if (!isCallee) throw forbidden();
  await query(`UPDATE notifications SET read_at = now() WHERE meeting_id = $1 AND user_id = $2 AND type = 'incoming_call'`, [m.id, req.user.id]);
  await query(`UPDATE meetings SET status = 'ended', ended_at = now(), ring_until = NULL WHERE id = $1`, [m.id]);
  await notify([m.organizer_id], {
    type: 'call_declined',
    title: `${req.user.full_name} n’a pas pu répondre`,
    body: 'Appel refusé.',
    link: '/contacts',
    meetingId: m.id,
  });
  await closeRoom(m.code);
  res.json({ ok: true });
});

/** La personne qui appelle raccroche avant la réponse : « appel manqué » chez l'autre. */
callsRouter.post('/:code/cancel', async (req, res) => {
  const { m, isCaller } = await loadCall(req);
  if (!isCaller) throw forbidden();
  if (!m.answered_at && m.status !== 'ended') {
    await tx((c) => markMissed(c, { ...m, caller_name: req.user.full_name }));
  }
  await closeRoom(m.code);
  res.json({ ok: true });
});
