import { config } from '../config.js';
import { pool, tx } from '../db.js';
import { closeRoom } from './livekit.js';
import { meetingReminderEmail, missedCallEmail, sendMail } from './mailer.js';
import { notify } from './notifications.js';
import { purgeExpiredRecordings } from './recordings.js';
import { getSettings } from './settings.js';

/**
 * Tâches planifiées de l'API :
 *  - rappel 10 minutes avant chaque réunion (Activité + e-mail HPO Mail) ;
 *  - appels sans réponse → « appel manqué » ;
 *  - suppression des enregistrements arrivés en fin de conservation.
 * Un verrou PostgreSQL garantit qu'une seule instance de l'API les exécute.
 */
const LOCK_ID = 7_310_402;
const firstName = (n) => String(n || '').split(' ')[0];

/** Rappels des réunions qui commencent dans les REMINDER_MINUTES prochaines minutes. */
export async function runMeetingReminders() {
  const minutes = config.reminderMinutes;
  const batches = await tx(async (c) => {
    const { rows: meetings } = await c.query(
      `SELECT m.* FROM meetings m
        WHERE m.kind = 'meeting' AND NOT m.is_permanent AND m.status <> 'ended'
          AND m.reminder_sent_at IS NULL AND m.scheduled_start IS NOT NULL
          AND m.scheduled_start <= now() + make_interval(mins => $1)
          AND m.scheduled_start > now() - interval '5 minutes'
        FOR UPDATE SKIP LOCKED`,
      [minutes],
    );
    const out = [];
    for (const m of meetings) {
      const { rows: people } = await c.query(
        `SELECT u.id, u.email, u.full_name FROM users u
          WHERE u.status = 'active'
            AND (u.id = $2 OR u.id IN (SELECT user_id FROM meeting_invitees WHERE meeting_id = $1))`,
        [m.id, m.organizer_id],
      );
      const when = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: process.env.TZ || 'Africa/Libreville' }).format(
        new Date(m.scheduled_start),
      );
      await notify(
        people.map((p) => p.id),
        {
          type: 'meeting_reminder',
          title: `« ${m.title} » commence dans ${minutes} minutes`,
          body: `Début à ${when} · code ${m.code}`,
          link: `/reunion/${m.code}`,
          meetingId: m.id,
        },
        c,
      );
      await c.query('UPDATE meetings SET reminder_sent_at = now() WHERE id = $1', [m.id]);
      out.push({ meeting: m, people });
    }
    return out;
  });

  // E-mails après validation : un échec d'envoi ne bloque pas les notifications
  for (const { meeting: m, people } of batches) {
    const url = `${config.appUrl}/reunion/${m.code}`;
    await Promise.allSettled(
      people.map((p) =>
        sendMail({
          to: p.email,
          ...meetingReminderEmail({ firstName: firstName(p.full_name), title: m.title, start: m.scheduled_start, code: m.code, url, minutes }),
        }),
      ),
    );
  }
  return batches.length;
}

/** Appels restés sans réponse après la sonnerie. */
export async function runMissedCalls() {
  const calls = await tx(async (c) => {
    const { rows } = await c.query(
      `SELECT m.*, u.full_name AS caller_name FROM meetings m LEFT JOIN users u ON u.id = m.organizer_id
        WHERE m.kind = 'call' AND m.status <> 'ended' AND m.answered_at IS NULL
          AND m.ring_until IS NOT NULL AND m.ring_until < now()
        FOR UPDATE OF m SKIP LOCKED`,
    );
    for (const m of rows) await markMissed(c, m);
    return rows;
  });
  for (const m of calls) await closeRoom(m.code);
  return calls.length;
}

/** Transforme la sonnerie en « appel manqué » (Activité + e-mail) et termine l'appel. */
export async function markMissed(c, m) {
  const { rows: targets } = await c.query(
    `UPDATE notifications n SET type = 'missed_call', title = $2, body = 'Rappelez depuis vos contacts.', link = '/contacts', read_at = NULL
       FROM users u
      WHERE n.meeting_id = $1 AND n.type = 'incoming_call' AND u.id = n.user_id
      RETURNING u.email, u.full_name`,
    [m.id, `Appel manqué de ${m.caller_name ?? 'un collègue'}`],
  );
  await c.query(`UPDATE meetings SET status = 'ended', ended_at = now(), ring_until = NULL WHERE id = $1`, [m.id]);
  for (const t of targets) {
    sendMail({
      to: t.email,
      ...missedCallEmail({ firstName: firstName(t.full_name), callerName: m.caller_name ?? 'Un collègue', at: m.created_at, url: `${config.appUrl}/contacts` }),
    }).catch(() => {});
  }
}

let lastPurge = 0;
export async function runRecordingPurge(force = false) {
  if (!force && Date.now() - lastPurge < 3600_000) return 0;
  lastPurge = Date.now();
  const s = await getSettings();
  return purgeExpiredRecordings(s.recording_retention_days);
}

async function tick() {
  const client = await pool.connect();
  try {
    const { rows } = await client.query('SELECT pg_try_advisory_lock($1) AS ok', [LOCK_ID]);
    if (!rows[0].ok) return;
    try {
      await runMeetingReminders();
      await runMissedCalls();
      await runRecordingPurge();
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]);
    }
  } catch (err) {
    console.error('[planificateur]', err.message);
  } finally {
    client.release();
  }
}

export function startScheduler() {
  if (!config.schedulerEnabled) return null;
  tick();
  return setInterval(tick, 15_000);
}
