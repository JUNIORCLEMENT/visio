import { one } from '../db.js';
import { meetingCode } from './tokens.js';

export async function findMeetingByCode(code) {
  if (!/^hpo-\d{3}-\d{3}$/.test(String(code))) return null;
  return one(
    `SELECT m.*, u.full_name AS organizer_name
       FROM meetings m LEFT JOIN users u ON u.id = m.organizer_id
      WHERE m.code = $1`,
    [code],
  );
}

/** Génère un code de réunion libre. */
export async function newMeetingCode(client) {
  for (let i = 0; i < 20; i++) {
    const code = meetingCode();
    const { rows } = await client.query('SELECT 1 FROM meetings WHERE code = $1', [code]);
    if (!rows.length) return code;
  }
  throw new Error('Impossible de générer un code de réunion libre.');
}

export function isHost(user, meeting) {
  return !!user && (user.role === 'admin' || meeting.organizer_id === user.id);
}

export function serializeMeeting(m, { live = new Map(), user = null } = {}) {
  return {
    id: m.id,
    code: m.code,
    kind: m.kind ?? 'meeting',
    title: m.title,
    description: m.description,
    department: m.department,
    organizerId: m.organizer_id,
    organizerName: m.organizer_name ?? null,
    isPermanent: m.is_permanent,
    scheduledStart: m.scheduled_start,
    scheduledEnd: m.scheduled_end,
    allowGuests: m.allow_guests,
    waitingRoom: m.waiting_room,
    recordingAllowed: m.recording_allowed,
    status: m.status,
    startedAt: m.started_at,
    endedAt: m.ended_at,
    participants: live.get(m.code) ?? 0,
    isHost: user ? isHost(user, m) : false,
  };
}
