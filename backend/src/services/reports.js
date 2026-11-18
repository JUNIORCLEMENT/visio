import { one, query } from '../db.js';

/**
 * Comptes rendus : une fiche par séance de réunion ou d'appel.
 * Données automatiques (horaires, présents, absents, discussion) + notes saisies par l'organisateur.
 */

/** Séances visibles : toutes pour un administrateur, sinon celles où la personne était organisatrice, conviée ou présente. */
export function visibilityClause(user, alias = 's', mAlias = 'm', param = '$1') {
  if (user.role === 'admin') return `(${param}::uuid IS NOT NULL)`;
  return `(${mAlias}.organizer_id = ${param}
           OR EXISTS (SELECT 1 FROM meeting_invitees i WHERE i.meeting_id = ${mAlias}.id AND i.user_id = ${param})
           OR EXISTS (SELECT 1 FROM attendance a WHERE a.session_id = ${alias}.id AND a.user_id = ${param}))`;
}

export async function listReports(user, search = '') {
  const s = search.trim().toLowerCase();
  const rows = await query(
    `SELECT s.id, s.started_at, s.ended_at, s.notes_updated_at,
            (s.notes IS NOT NULL OR s.decisions IS NOT NULL OR s.actions IS NOT NULL) AS has_notes,
            m.title, m.code, m.kind, u.full_name AS organizer_name,
            (SELECT count(DISTINCT a.identity)::int FROM attendance a WHERE a.session_id = s.id) AS participants,
            EXISTS (SELECT 1 FROM recordings r WHERE r.session_id = s.id AND r.status = 'ready') AS recorded
       FROM meeting_sessions s
       JOIN meetings m ON m.id = s.meeting_id
       LEFT JOIN users u ON u.id = m.organizer_id
      WHERE ${visibilityClause(user)}
        AND ($2 = '' OR lower(m.title) LIKE '%' || $2 || '%' OR m.code LIKE '%' || $2 || '%' OR lower(coalesce(u.full_name, '')) LIKE '%' || $2 || '%')
      ORDER BY s.started_at DESC
      LIMIT 300`,
    [user.id, s],
  );
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    code: r.code,
    kind: r.kind,
    organizerName: r.organizer_name,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    participants: r.participants,
    hasNotes: r.has_notes,
    recorded: r.recorded,
  }));
}

/** Fiche complète, ou null si introuvable / non autorisée. */
export async function getReport(user, sessionId) {
  const head = await one(
    `SELECT s.*, m.id AS meeting_id, m.title, m.code, m.kind, m.description, m.department, m.organizer_id,
            m.scheduled_start, m.scheduled_end,
            u.full_name AS organizer_name, u.email AS organizer_email, u.department AS organizer_department,
            nu.full_name AS notes_updated_by_name
       FROM meeting_sessions s
       JOIN meetings m ON m.id = s.meeting_id
       LEFT JOIN users u ON u.id = m.organizer_id
       LEFT JOIN users nu ON nu.id = s.notes_updated_by
      WHERE s.id = $2 AND ${visibilityClause(user, 's', 'm', '$1')}`,
    [user.id, sessionId],
  ).catch(() => null);
  if (!head) return null;

  const end = head.ended_at ?? new Date();

  // Présences regroupées par personne (plusieurs arrivées possibles après une coupure)
  const attendees = await query(
    `SELECT a.identity, max(a.display_name) AS name, min(a.joined_at) AS first_join,
            max(coalesce(a.left_at, $2)) AS last_leave,
            sum(extract(epoch FROM coalesce(a.left_at, $2) - a.joined_at))::int AS seconds,
            max(u.department) AS department, max(u.job_title) AS job_title, max(g.organization) AS organization,
            bool_or(a.guest_id IS NOT NULL) AS is_guest, max(a.user_id::text) AS user_id
       FROM attendance a
       LEFT JOIN users u ON u.id = a.user_id
       LEFT JOIN guest_requests g ON g.id = a.guest_id
      WHERE a.session_id = $1
      GROUP BY a.identity
      ORDER BY min(a.joined_at)`,
    [head.id, end],
  );
  const presentIds = new Set(attendees.map((a) => a.user_id).filter(Boolean));

  const invited = await query(
    `SELECT u.id, u.full_name, u.department FROM users u
      WHERE u.id = $2 OR u.id IN (SELECT user_id FROM meeting_invitees WHERE meeting_id = $1)
      ORDER BY u.full_name`,
    [head.meeting_id, head.organizer_id],
  );
  const absent = invited.filter((u) => !presentIds.has(u.id));

  const messages = await query(
    `SELECT sender_name, body, created_at FROM chat_messages
      WHERE meeting_id = $1 AND created_at >= $2 AND created_at <= $3 ORDER BY id`,
    [head.meeting_id, head.started_at, end],
  );

  const recordings = await query(
    `SELECT id, status, duration_seconds, size_bytes FROM recordings WHERE session_id = $1 ORDER BY started_at`,
    [head.id],
  );

  return {
    id: head.id,
    meeting: {
      id: head.meeting_id,
      title: head.title,
      code: head.code,
      kind: head.kind,
      agenda: head.description,
      department: head.department,
      organizerId: head.organizer_id,
      organizerName: head.organizer_name,
      organizerEmail: head.organizer_email,
      organizerDepartment: head.organizer_department,
      scheduledStart: head.scheduled_start,
    },
    startedAt: head.started_at,
    endedAt: head.ended_at,
    durationSeconds: Math.max(0, Math.round((new Date(end).getTime() - new Date(head.started_at).getTime()) / 1000)),
    attendees: attendees.map((a) => ({
      identity: a.identity,
      name: a.name,
      detail: a.is_guest ? (a.organization ? `Invité externe · ${a.organization}` : 'Invité externe') : [a.department, a.job_title].filter(Boolean).join(' · ') || null,
      isGuest: a.is_guest,
      firstJoin: a.first_join,
      lastLeave: a.last_leave,
      seconds: a.seconds ?? 0,
    })),
    absent: absent.map((u) => ({ name: u.full_name, department: u.department })),
    notes: head.notes,
    decisions: head.decisions,
    actions: head.actions,
    notesUpdatedAt: head.notes_updated_at,
    notesUpdatedBy: head.notes_updated_by_name,
    messages: messages.map((m) => ({ senderName: m.sender_name, body: m.body, createdAt: m.created_at })),
    recordings: recordings.map((r) => ({ id: r.id, status: r.status, durationSeconds: r.duration_seconds })),
    canEdit: user.role === 'admin' || head.organizer_id === user.id,
  };
}
