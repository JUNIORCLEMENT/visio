import { one, query } from '../db.js';

/**
 * Séances de réunion et présences.
 * Une séance commence quand la salle LiveKit s'ouvre et se termine quand elle se ferme.
 * Les arrivées et départs sont envoyés par LiveKit (webhooks) : voir routes/webhook.routes.js.
 */

/** Renvoie la séance ouverte de la réunion, ou en crée une. */
export async function ensureOpenSession(meetingId, roomSid = null) {
  return one(
    `INSERT INTO meeting_sessions (meeting_id, room_sid) VALUES ($1, $2)
     ON CONFLICT (meeting_id) WHERE ended_at IS NULL
     DO UPDATE SET room_sid = COALESCE(EXCLUDED.room_sid, meeting_sessions.room_sid)
     RETURNING *`,
    [meetingId, roomSid],
  );
}

/** Ferme la séance ouverte et clôt les présences encore en cours. */
export async function closeOpenSession(meetingId) {
  const s = await one(
    `UPDATE meeting_sessions SET ended_at = now() WHERE meeting_id = $1 AND ended_at IS NULL RETURNING *`,
    [meetingId],
  );
  if (s) await query(`UPDATE attendance SET left_at = now() WHERE session_id = $1 AND left_at IS NULL`, [s.id]);
  return s;
}

/** Identité LiveKit → { userId } ou { guestId }. Les autres (enregistreur…) sont ignorées. */
export function parseIdentity(identity) {
  const m = /^([ug]):([0-9a-f-]{36})$/i.exec(String(identity ?? ''));
  if (!m) return null;
  return m[1] === 'u' ? { userId: m[2], guestId: null } : { userId: null, guestId: m[2] };
}

export async function recordJoin(meeting, { identity, name }) {
  const who = parseIdentity(identity);
  if (!who) return null;
  const session = await ensureOpenSession(meeting.id);
  // Évite les doublons si LiveKit renvoie l'événement (reconnexion)
  const open = await one(`SELECT id FROM attendance WHERE session_id = $1 AND identity = $2 AND left_at IS NULL`, [session.id, identity]);
  if (!open) {
    await query(
      `INSERT INTO attendance (session_id, identity, user_id, guest_id, display_name) VALUES ($1, $2, $3, $4, $5)`,
      [session.id, identity, who.userId, who.guestId, name || identity],
    );
  }
  // Appel : la personne appelée a décroché
  if (meeting.kind === 'call' && who.userId && who.userId !== meeting.organizer_id) {
    await query(`UPDATE meetings SET answered_at = COALESCE(answered_at, now()), ring_until = NULL WHERE id = $1`, [meeting.id]);
    await query(
      `UPDATE notifications SET read_at = now() WHERE meeting_id = $1 AND user_id = $2 AND type = 'incoming_call' AND read_at IS NULL`,
      [meeting.id, who.userId],
    );
  }
  return session;
}

export async function recordLeave(meeting, { identity }) {
  await query(
    `UPDATE attendance SET left_at = now()
      WHERE id = (SELECT a.id FROM attendance a JOIN meeting_sessions s ON s.id = a.session_id
                   WHERE s.meeting_id = $1 AND a.identity = $2 AND a.left_at IS NULL
                   ORDER BY a.joined_at DESC LIMIT 1)`,
    [meeting.id, identity],
  );
}
