import express, { Router } from 'express';
import path from 'node:path';
import { EgressStatus } from 'livekit-server-sdk';
import { one, query } from '../db.js';
import { webhookReceiver } from '../services/livekit.js';
import { findMeetingByCode } from '../services/meetings.js';
import { recordingsRoot, toLocalPath } from '../services/recordings.js';
import { closeOpenSession, ensureOpenSession, recordJoin, recordLeave } from '../services/sessions.js';

/**
 * Événements envoyés par LiveKit (configuration « webhook » du serveur LiveKit).
 * Ils alimentent les présences des comptes rendus et la liste des enregistrements.
 * Chaque appel est signé avec la clé API LiveKit : les requêtes non signées sont rejetées.
 */
export const webhookRouter = Router();

const TERMINAL = new Set([EgressStatus.EGRESS_COMPLETE, EgressStatus.EGRESS_FAILED, EgressStatus.EGRESS_ABORTED, EgressStatus.EGRESS_LIMIT_REACHED]);

webhookRouter.post('/', express.text({ type: () => true, limit: '1mb' }), async (req, res) => {
  let event;
  try {
    event = await webhookReceiver.receive(String(req.body ?? ''), req.get('authorization') ?? undefined);
  } catch {
    return res.status(401).json({ error: 'Signature LiveKit invalide.' });
  }
  try {
    await handle(event);
  } catch (err) {
    console.error('[webhook]', event?.event, err.message);
  }
  res.json({ ok: true });
});

async function handle(event) {
  const roomName = event.room?.name ?? event.egressInfo?.roomName;
  const meeting = roomName ? await findMeetingByCode(roomName) : null;

  switch (event.event) {
    case 'room_started':
      if (!meeting) return;
      await ensureOpenSession(meeting.id, event.room.sid);
      await query(
        `UPDATE meetings SET status = 'live', started_at = COALESCE(CASE WHEN status = 'live' THEN started_at END, now()) WHERE id = $1`,
        [meeting.id],
      );
      return;

    case 'room_finished':
      if (!meeting) return;
      await closeOpenSession(meeting.id);
      await query(
        `UPDATE meetings SET
            status = CASE WHEN kind = 'call' OR status = 'ended' THEN 'ended'::meeting_status ELSE 'scheduled'::meeting_status END,
            ended_at = now(), ring_until = NULL
          WHERE id = $1`,
        [meeting.id],
      );
      return;

    case 'participant_joined':
      if (meeting && event.participant) await recordJoin(meeting, event.participant);
      return;

    case 'participant_left':
      if (meeting && event.participant) await recordLeave(meeting, event.participant);
      return;

    case 'egress_started':
      await upsertRecording(event.egressInfo, meeting);
      return;

    case 'egress_updated':
    case 'egress_ended':
      await upsertRecording(event.egressInfo, meeting);
      return;

    default:
  }
}

async function upsertRecording(info, meeting) {
  if (!info?.egressId) return;
  const session = meeting
    ? await one(`SELECT id FROM meeting_sessions WHERE meeting_id = $1 ORDER BY started_at DESC LIMIT 1`, [meeting.id])
    : null;
  const done = TERMINAL.has(info.status);
  const file = info.fileResults?.[0] ?? info.file ?? null;
  const local = file?.filename ? toLocalPath(file.filename) : null;
  const status = !done ? 'recording' : info.status === EgressStatus.EGRESS_COMPLETE && local ? 'ready' : 'failed';
  const error = status === 'failed' ? info.error || 'Enregistrement interrompu.' : null;

  await query(
    `INSERT INTO recordings (egress_id, meeting_id, session_id, room_name, title, kind, organizer_name, status,
                             file_path, size_bytes, duration_seconds, started_at, ended_at, error)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now(), CASE WHEN $12 THEN now() END, $13)
     ON CONFLICT (egress_id) DO UPDATE SET
       status = EXCLUDED.status,
       file_path = COALESCE(EXCLUDED.file_path, recordings.file_path),
       size_bytes = COALESCE(EXCLUDED.size_bytes, recordings.size_bytes),
       duration_seconds = COALESCE(EXCLUDED.duration_seconds, recordings.duration_seconds),
       ended_at = COALESCE(EXCLUDED.ended_at, recordings.ended_at),
       error = EXCLUDED.error`,
    [
      info.egressId,
      meeting?.id ?? null,
      session?.id ?? null,
      info.roomName ?? meeting?.code ?? 'inconnu',
      meeting?.title ?? info.roomName ?? 'Réunion',
      meeting?.kind ?? 'meeting',
      meeting?.organizer_name ?? null,
      status,
      local ? path.relative(recordingsRoot, local) : null,
      file?.size !== undefined && file?.size !== null ? Number(file.size) : null,
      file?.duration ? Math.round(Number(file.duration) / 1e9) : null,
      done,
      error,
    ],
  );
}
