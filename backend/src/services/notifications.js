import { query } from '../db.js';

/**
 * Activité : notifications affichées dans HPO Visio (cloche « Activité »).
 * Les e-mails HPO Mail sont envoyés à part (services/mailer.js).
 */
export async function notify(userIds, { type, title, body = null, link = null, meetingId = null }, client = null) {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!ids.length) return;
  const run = client ? (t, p) => client.query(t, p) : (t, p) => query(t, p);
  await run(
    `INSERT INTO notifications (user_id, type, title, body, link, meeting_id)
     SELECT u, $2, $3, $4, $5, $6 FROM unnest($1::uuid[]) AS u`,
    [ids, type, title, body, link, meetingId],
  );
}

export function serializeNotification(n) {
  return {
    id: Number(n.id),
    type: n.type,
    title: n.title,
    body: n.body,
    link: n.link,
    meetingCode: n.meeting_code ?? null,
    createdAt: n.created_at,
    read: !!n.read_at,
  };
}
