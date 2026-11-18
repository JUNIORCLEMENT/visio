import { Router } from 'express';
import { one, query } from '../db.js';
import { requireUser } from '../middleware/auth.js';
import { serializeNotification } from '../services/notifications.js';

/** Activité : notifications de la personne connectée. */
export const notificationsRouter = Router();
notificationsRouter.use(requireUser);

notificationsRouter.get('/', async (req, res) => {
  const rows = await query(
    `SELECT n.*, m.code AS meeting_code FROM notifications n LEFT JOIN meetings m ON m.id = n.meeting_id
      WHERE n.user_id = $1 ORDER BY n.created_at DESC LIMIT 100`,
    [req.user.id],
  );
  res.json({ notifications: rows.map(serializeNotification) });
});

/**
 * Interrogé toutes les quelques secondes par le navigateur :
 * nombre de notifications non lues + appel entrant éventuel. Met aussi à jour la présence.
 */
notificationsRouter.get('/summary', async (req, res) => {
  await query(
    `UPDATE users SET last_seen_at = now() WHERE id = $1 AND (last_seen_at IS NULL OR last_seen_at < now() - interval '30 seconds')`,
    [req.user.id],
  );
  const unread = await one(`SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL`, [req.user.id]);
  const call = await one(
    `SELECT n.id, n.created_at, m.code, m.title, u.full_name AS caller_name, u.department AS caller_department
       FROM notifications n
       JOIN meetings m ON m.id = n.meeting_id
       LEFT JOIN users u ON u.id = m.organizer_id
      WHERE n.user_id = $1 AND n.type = 'incoming_call' AND n.read_at IS NULL
        AND m.status <> 'ended' AND m.ring_until > now()
      ORDER BY n.created_at DESC LIMIT 1`,
    [req.user.id],
  );
  res.json({
    unread: unread.n,
    incomingCall: call
      ? { notificationId: Number(call.id), code: call.code, callerName: call.caller_name, callerDepartment: call.caller_department, createdAt: call.created_at }
      : null,
  });
});

notificationsRouter.post('/read-all', async (req, res) => {
  await query(`UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL AND type <> 'incoming_call'`, [req.user.id]);
  res.json({ ok: true });
});

notificationsRouter.post('/:id/read', async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (Number.isFinite(id)) {
    await query(`UPDATE notifications SET read_at = COALESCE(read_at, now()) WHERE id = $1 AND user_id = $2`, [id, req.user.id]);
  }
  res.json({ ok: true });
});
