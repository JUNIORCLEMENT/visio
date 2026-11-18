import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { one, query } from '../db.js';

/**
 * Enregistrements des réunions et appels.
 * LiveKit Egress écrit les fichiers MP4 dans un dossier partagé ; l'API les sert
 * uniquement aux administrateurs (onglet Admin › Enregistrements).
 */
export const recordingsRoot = path.resolve(config.recording.dir);

/** Chemin vu par Egress (/out/…) → chemin local sûr, ou null s'il sort du dossier. */
export function toLocalPath(egressPath) {
  if (!egressPath) return null;
  const egressRoot = config.recording.egressDir.replace(/\/$/, '');
  const rel = egressPath.startsWith(egressRoot + '/') ? egressPath.slice(egressRoot.length + 1) : path.basename(egressPath);
  return safeResolve(rel);
}

/** Résout un chemin relatif au dossier des enregistrements, sans permettre d'en sortir. */
export function safeResolve(relOrAbs) {
  const full = path.resolve(recordingsRoot, relOrAbs);
  return full.startsWith(recordingsRoot + path.sep) ? full : null;
}

export function serializeRecording(r) {
  return {
    id: r.id,
    title: r.title,
    kind: r.kind,
    roomName: r.room_name,
    organizerName: r.organizer_name,
    status: r.status,
    sizeBytes: r.size_bytes === null ? null : Number(r.size_bytes),
    durationSeconds: r.duration_seconds,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    error: r.error,
    sessionId: r.session_id,
    available: r.status === 'ready' && !!r.file_path,
  };
}

/** Supprime le fichier puis la ligne. */
export async function deleteRecording(rec) {
  if (rec.file_path) {
    const p = safeResolve(rec.file_path);
    if (p) await fs.rm(p, { force: true });
  }
  await query('DELETE FROM recordings WHERE id = $1', [rec.id]);
}

/** Supprime les enregistrements plus anciens que la durée de conservation. */
export async function purgeExpiredRecordings(retentionDays) {
  const rows = await query(
    `SELECT * FROM recordings WHERE status <> 'recording' AND started_at < now() - make_interval(days => $1)`,
    [retentionDays],
  );
  for (const r of rows) await deleteRecording(r);
  return rows.length;
}

export async function findRecording(id) {
  return one('SELECT * FROM recordings WHERE id = $1', [id]).catch(() => null);
}
