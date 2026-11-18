/**
 * Tests de la version 2 : Contacts et appels, rappels 10 min (Activité + HPO Mail),
 * webhooks LiveKit, comptes rendus Word, enregistrements DSID.
 *   TEST_DATABASE_URL=postgres://.../hpo_visio_test npm test
 * ⚠ La base de test est VIDÉE au début.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { strFromU8, unzipSync } from 'fflate';

const recDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hpo-rec-'));
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://postgres@localhost:5432/hpo_visio_test';
process.env.SESSION_SECRET = 'test-secret-'.padEnd(48, 'x');
process.env.APP_URL = 'http://localhost:4200';
process.env.HPO_MAIL_DOMAINS = 'hpo-groupe.com';
process.env.AUTH_PROVIDER = 'local';
process.env.DIRECTORY_PROVIDER = 'db';
process.env.SMTP_HOST = '';
process.env.LIVEKIT_API_URL = 'http://127.0.0.1:59999';
process.env.LIVEKIT_API_KEY = 'devkey';
process.env.LIVEKIT_API_SECRET = 'secret';
process.env.TRUST_PROXY = 'false';
process.env.SCHEDULER_ENABLED = 'false';
process.env.RECORDINGS_DIR = recDir;
process.env.EGRESS_OUTPUT_DIR = '/out';

const { createApp } = await import('../src/app.js');
const { pool } = await import('../src/db.js');
const { outbox } = await import('../src/services/mailer.js');
const { hashPassword } = await import('../src/services/passwords.js');
const { runMeetingReminders, runMissedCalls, runRecordingPurge } = await import('../src/services/scheduler.js');
const { AccessToken } = await import('livekit-server-sdk');

let server;
let base;
const PWD = 'MotDePasse2026';
const ids = {};

function client() {
  let cookie = '';
  return async (method, p, body, headers = {}) => {
    const res = await fetch(base + p, {
      method,
      headers: {
        ...(body !== undefined && typeof body !== 'string' ? { 'content-type': 'application/json' } : {}),
        ...(cookie ? { cookie } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
    for (const c of res.headers.getSetCookie?.() ?? []) cookie = c.split(';')[0];
    const type = res.headers.get('content-type') || '';
    const data = type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer());
    return { status: res.status, data, headers: res.headers };
  };
}

/** Webhook signé comme le fait LiveKit. */
async function webhook(event) {
  const body = JSON.stringify({ id: crypto.randomUUID(), createdAt: String(Math.floor(Date.now() / 1000)), ...event });
  const at = new AccessToken('devkey', 'secret');
  at.sha256 = crypto.createHash('sha256').update(body).digest('base64');
  const token = await at.toJwt();
  const res = await fetch(base + '/api/livekit/webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/webhook+json', authorization: token },
    body,
  });
  return res.status;
}

const lastMailTo = (to) => [...outbox].reverse().find((m) => m.to === to);

before(async () => {
  await pool.query(`TRUNCATE users, invitations, password_resets, login_challenges, meeting_invitees, guest_requests,
                    chat_messages, audit_logs, notifications, meeting_sessions, attendance, recordings RESTART IDENTITY CASCADE`);
  await pool.query(await fs.readFile(new URL('../../database/init/03-demo.sql', import.meta.url), 'utf8'));
  // (TRUNCATE … CASCADE vide aussi « settings », liée à users)
  await pool.query(`INSERT INTO settings (key, value) VALUES
      ('admin_2fa', 'false'), ('external_2fa', 'false'), ('recording_allowed', 'true'), ('allow_guests', 'true'),
      ('guest_waiting_room', 'true'), ('recording_retention_days', '90'), ('invitation_default_ttl', '72')
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`);
  const hash = await hashPassword(PWD);
  const people = [
    ['admin', 'franck.nguema@hpo-groupe.com', 'Franck Nguema', 'Informatique', 'admin'],
    ['alice', 'aicha.ndong@hpo-groupe.com', 'Aïcha Ndong', 'Opérations', 'organizer'],
    ['bob', 'paul.mba@hpo-groupe.com', 'Paul Mba', 'Finances', 'user'],
    ['carl', 'sandrine.mboumba@hpo-groupe.com', 'Sandrine Mboumba', 'Finances', 'user'],
  ];
  for (const [k, email, name, dep, role] of people) {
    const { rows } = await pool.query(
      `INSERT INTO users (email, full_name, department, role, password_hash) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [email, name, dep, role, hash],
    );
    ids[k] = { id: rows[0].id, email, name };
  }
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server?.close();
  await pool.end();
  await fs.rm(recDir, { recursive: true, force: true });
});

describe('HPO Visio v2', () => {
  const admin = client();
  const alice = client();
  const bob = client();
  const carl = client();
  let meetingCode;
  let sessionId;

  test('connexions', async () => {
    for (const [c, k] of [[admin, 'admin'], [alice, 'alice'], [bob, 'bob'], [carl, 'carl']]) {
      const r = await c('POST', '/api/auth/login', { email: ids[k].email, password: PWD });
      assert.equal(r.status, 200, k);
    }
  });

  test('Contacts : collègues, recherche et présence', async () => {
    await bob('GET', '/api/notifications/summary'); // marque Paul en ligne
    const r = await alice('GET', '/api/contacts');
    const names = r.data.contacts.map((c) => c.fullName);
    assert.ok(names.includes('Paul Mba'));
    assert.ok(!names.includes('Aïcha Ndong'), 'pas soi-même');
    assert.equal(r.data.contacts.find((c) => c.fullName === 'Paul Mba').online, true);
    const f = await alice('GET', '/api/contacts?search=financ');
    assert.deepEqual(f.data.contacts.map((c) => c.fullName).sort(), ['Paul Mba', 'Sandrine Mboumba']);
  });

  test('Activité : convocation puis rappel 10 min (une seule fois) + e-mail HPO Mail', async () => {
    const r = await alice('POST', '/api/meetings', {
      title: 'Comité de direction',
      description: 'Budget 2027\nPlanning Moanda',
      scheduledStart: new Date(Date.now() + 8 * 60_000).toISOString(),
      durationMinutes: 60,
      inviteeEmails: [ids.bob.email],
    });
    assert.equal(r.status, 201);
    meetingCode = r.data.meeting.code;
    const later = await alice('POST', '/api/meetings', {
      title: 'Plus tard',
      scheduledStart: new Date(Date.now() + 40 * 60_000).toISOString(),
      inviteeEmails: [ids.bob.email],
    });
    assert.equal(later.status, 201);

    let n = (await bob('GET', '/api/notifications')).data.notifications;
    assert.ok(n.some((x) => x.type === 'meeting_invite' && x.title.includes('Comité de direction')));

    assert.equal(await runMeetingReminders(), 1, 'seule la réunion qui commence dans moins de 10 min');
    assert.equal(await runMeetingReminders(), 0, 'pas de doublon');

    n = (await bob('GET', '/api/notifications')).data.notifications;
    const rem = n.find((x) => x.type === 'meeting_reminder');
    assert.match(rem.title, /commence dans 10 minutes/);
    assert.equal(rem.link, `/reunion/${meetingCode}`);
    const aliceN = (await alice('GET', '/api/notifications')).data.notifications;
    assert.ok(aliceN.some((x) => x.type === 'meeting_reminder'), 'l’organisatrice aussi');
    assert.match(lastMailTo(ids.bob.email).subject, /^Rappel : « Comité de direction » commence dans 10 minutes/);
    assert.match(lastMailTo(ids.alice.email).subject, /^Rappel/);

    const s = await bob('GET', '/api/notifications/summary');
    assert.ok(s.data.unread >= 2);
    await bob('POST', '/api/notifications/read-all');
    assert.equal((await bob('GET', '/api/notifications/summary')).data.unread, 0);
  });

  test('Appel refusé', async () => {
    const r = await alice('POST', '/api/calls', { userId: ids.bob.id });
    assert.equal(r.status, 201);
    assert.equal(r.data.meeting.kind, 'call');
    const code = r.data.meeting.code;
    const s = await bob('GET', '/api/notifications/summary');
    assert.equal(s.data.incomingCall.code, code);
    assert.equal(s.data.incomingCall.callerName, 'Aïcha Ndong');
    assert.equal((await alice('POST', '/api/calls', { userId: ids.bob.id })).status, 409, 'déjà en train de sonner');
    assert.equal((await carl('GET', `/api/meetings/${code}`)).status, 404, 'appel privé');
    assert.equal((await admin('GET', `/api/meetings/${code}`)).status, 200, 'la DSID voit tout');

    assert.equal((await bob('POST', `/api/calls/${code}/decline`)).status, 200);
    assert.equal((await bob('GET', '/api/notifications/summary')).data.incomingCall, null);
    const an = (await alice('GET', '/api/notifications')).data.notifications;
    assert.ok(an.some((x) => x.type === 'call_declined'));
    assert.equal((await alice('POST', `/api/meetings/${code}/join`)).status, 410);
    assert.equal((await alice('POST', '/api/calls', { userId: ids.alice.id })).status, 400);
  });

  test('Appel manqué (sonnerie écoulée) → Activité + e-mail', async () => {
    const r = await alice('POST', '/api/calls', { userId: ids.bob.id });
    await pool.query(`UPDATE meetings SET ring_until = now() - interval '1 second' WHERE code = $1`, [r.data.meeting.code]);
    assert.equal(await runMissedCalls(), 1);
    const n = (await bob('GET', '/api/notifications')).data.notifications;
    assert.ok(n.some((x) => x.type === 'missed_call' && x.title === 'Appel manqué de Aïcha Ndong'));
    assert.equal(lastMailTo(ids.bob.email).subject, 'Appel manqué de Aïcha Ndong');
  });

  test('Appel décroché (webhook LiveKit) puis raccroché par l’appelé', async () => {
    const r = await alice('POST', '/api/calls', { userId: ids.bob.id });
    const code = r.data.meeting.code;
    assert.equal((await alice('POST', `/api/meetings/${code}/join`)).status, 200);
    assert.equal((await bob('POST', `/api/meetings/${code}/join`)).status, 200);
    assert.equal(await webhook({ event: 'participant_joined', room: { name: code, sid: 'RM_call' }, participant: { identity: `u:${ids.bob.id}`, name: 'Paul Mba' } }), 200);
    assert.equal((await bob('GET', '/api/notifications/summary')).data.incomingCall, null, 'décroché');
    assert.equal(await runMissedCalls(), 0);
    assert.equal((await bob('POST', `/api/meetings/${code}/end`)).status, 200, 'l’appelé peut raccrocher');
    assert.equal((await carl('POST', `/api/meetings/${code}/end`)).status, 404);
  });

  test('Webhooks : signature obligatoire', async () => {
    const res = await fetch(base + '/api/livekit/webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/webhook+json', authorization: 'faux' },
      body: '{"event":"room_started"}',
    });
    assert.equal(res.status, 401);
  });

  test('Séance : présences, enregistrement, fin', async () => {
    const join = await alice('POST', `/api/meetings/${meetingCode}/join`);
    assert.equal(join.status, 200);
    assert.equal(join.data.meeting.recording, true, 'enregistrement annoncé');
    const room = { name: meetingCode, sid: 'RM_abc' };
    assert.equal(await webhook({ event: 'room_started', room }), 200);
    await webhook({ event: 'participant_joined', room, participant: { identity: `u:${ids.alice.id}`, name: 'Aïcha Ndong' } });
    await webhook({ event: 'participant_joined', room, participant: { identity: `u:${ids.bob.id}`, name: 'Paul Mba' } });
    await webhook({ event: 'participant_joined', room, participant: { identity: 'EG_recorder', name: '' } });
    await webhook({ event: 'egress_started', room, egressInfo: { egressId: 'EG_1', roomName: meetingCode, status: 'EGRESS_ACTIVE' } });
    await alice('POST', `/api/meetings/${meetingCode}/messages`, { body: 'Point 1 validé' });

    // Fichier écrit par Egress dans le dossier partagé
    const fname = `${meetingCode}-2026-11-13T100000.mp4`;
    await fs.writeFile(path.join(recDir, fname), Buffer.alloc(4096, 1));
    await webhook({ event: 'participant_left', room, participant: { identity: `u:${ids.bob.id}`, name: 'Paul Mba' } });
    await webhook({
      event: 'egress_ended',
      room,
      egressInfo: {
        egressId: 'EG_1',
        roomName: meetingCode,
        status: 'EGRESS_COMPLETE',
        fileResults: [{ filename: `/out/${fname}`, size: '4096', duration: '61000000000' }],
      },
    });
    await webhook({ event: 'room_finished', room });

    const s = await pool.query(`SELECT s.* FROM meeting_sessions s JOIN meetings m ON m.id = s.meeting_id WHERE m.code = $1`, [meetingCode]);
    assert.equal(s.rows.length, 1);
    assert.ok(s.rows[0].ended_at, 'séance close');
    assert.equal(s.rows[0].room_sid, 'RM_abc');
    sessionId = s.rows[0].id;
    const att = await pool.query('SELECT * FROM attendance WHERE session_id = $1', [sessionId]);
    assert.equal(att.rows.length, 2, 'l’enregistreur n’est pas compté');
    assert.ok(att.rows.every((a) => a.left_at));
  });

  test('Comptes rendus : liste, fiche, notes, droits', async () => {
    const list = await bob('GET', '/api/reports');
    assert.ok(list.data.reports.some((r) => r.id === sessionId && r.recorded && r.participants === 2));
    assert.equal((await carl('GET', `/api/reports/${sessionId}`)).status, 404, 'ni convié ni présent');

    const d = (await bob('GET', `/api/reports/${sessionId}`)).data.report;
    assert.equal(d.meeting.title, 'Comité de direction');
    assert.deepEqual(d.attendees.map((a) => a.name), ['Aïcha Ndong', 'Paul Mba']);
    assert.equal(d.messages[0].body, 'Point 1 validé');
    assert.equal(d.canEdit, false);

    assert.equal((await bob('PUT', `/api/reports/${sessionId}`, { notes: 'x' })).status, 403);
    const up = await alice('PUT', `/api/reports/${sessionId}`, {
      notes: 'Revue du budget 2027.',
      decisions: '- Budget validé\n- Recrutement de 2 techniciens à Moanda',
      actions: '- Paul : chiffrer le planning',
    });
    assert.equal(up.status, 200);
    assert.equal(up.data.report.notesUpdatedBy, 'Aïcha Ndong');
  });

  test('Compte rendu exporté en Word (.docx)', async () => {
    const r = await bob('GET', `/api/reports/${sessionId}/docx`);
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /wordprocessingml/);
    assert.match(r.headers.get('content-disposition'), /CR_\d{4}-\d{2}-\d{2}_Comite-de-direction\.docx/);
    const files = unzipSync(new Uint8Array(r.data));
    const xml = strFromU8(files['word/document.xml']);
    for (const t of ['Comité de direction', 'Budget validé', 'Paul Mba', 'Décisions', 'Point 1 validé', 'conservé par la DSID']) {
      assert.ok(xml.includes(t), `contient « ${t} »`);
    }
    assert.ok(Object.keys(files).some((f) => f.startsWith('word/media/')), 'logo HPO');
  });

  test('Enregistrements : onglet DSID, lecture, téléchargement, suppression', async () => {
    assert.equal((await alice('GET', '/api/admin/recordings')).status, 403, 'réservé à la DSID');
    const l = await admin('GET', '/api/admin/recordings');
    assert.equal(l.data.recordings.length, 1);
    const rec = l.data.recordings[0];
    assert.equal(rec.status, 'ready');
    assert.equal(rec.durationSeconds, 61);
    assert.equal(rec.title, 'Comité de direction');
    assert.equal(l.data.totals.bytes, 4096);

    const play = await admin('GET', `/api/admin/recordings/${rec.id}/file`, undefined, { range: 'bytes=0-99' });
    assert.equal(play.status, 206);
    assert.equal(play.data.length, 100);
    const dl = await admin('GET', `/api/admin/recordings/${rec.id}/file?download=1`);
    assert.equal(dl.status, 200);
    assert.match(dl.headers.get('content-disposition'), /attachment/);

    // Chemin piégé : refusé
    const evil = await pool.query(
      `INSERT INTO recordings (room_name, title, status, file_path) VALUES ('x', 'piège', 'ready', '../../../etc/passwd') RETURNING id`,
    );
    assert.equal((await admin('GET', `/api/admin/recordings/${evil.rows[0].id}/file`)).status, 404);

    assert.equal((await admin('DELETE', `/api/admin/recordings/${rec.id}`)).status, 200);
    await assert.rejects(fs.stat(path.join(recDir, `${meetingCode}-2026-11-13T100000.mp4`)));
  });

  test('Conservation : suppression automatique après la durée choisie', async () => {
    await fs.writeFile(path.join(recDir, 'ancien.mp4'), 'x');
    await pool.query(
      `INSERT INTO recordings (room_name, title, status, file_path, started_at) VALUES ('hpo-000-000', 'Ancien', 'ready', 'ancien.mp4', now() - interval '100 days')`,
    );
    assert.equal(await runRecordingPurge(true), 1);
    await assert.rejects(fs.stat(path.join(recDir, 'ancien.mp4')));
  });
});
