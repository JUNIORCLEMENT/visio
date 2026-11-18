-- =====================================================================
--  HPO Visio — version 2 : appels, Activité, comptes rendus, enregistrements
--
--  Installation neuve : exécuté automatiquement après 01-schema.sql.
--  Base déjà installée en version 1 : exécuter ce fichier une fois
--    docker compose exec -T db psql -U hpo -d hpo_visio < database/init/02-schema-v2.sql
--  Le script peut être relancé sans risque.
-- =====================================================================

BEGIN;

DO $$ BEGIN
  CREATE TYPE meeting_kind AS ENUM ('meeting', 'call');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE notification_type AS ENUM ('meeting_invite', 'meeting_reminder', 'incoming_call', 'missed_call', 'call_declined');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE recording_status AS ENUM ('recording', 'ready', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------- Présence (page Contacts) ----------------------------------
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;

-- ---------- Réunions et appels ----------------------------------------
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS kind meeting_kind NOT NULL DEFAULT 'meeting';
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMPTZ;   -- rappel 10 min envoyé
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS ring_until TIMESTAMPTZ;         -- appel : fin de la sonnerie
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS answered_at TIMESTAMPTZ;        -- appel : décroché
CREATE INDEX IF NOT EXISTS idx_meetings_reminder ON meetings(scheduled_start) WHERE reminder_sent_at IS NULL;

-- ---------- Activité (notifications) ----------------------------------
CREATE TABLE IF NOT EXISTS notifications (
  id          BIGSERIAL PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        notification_type NOT NULL,
  title       TEXT NOT NULL,
  body        TEXT,
  link        TEXT,
  meeting_id  UUID REFERENCES meetings(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(user_id) WHERE read_at IS NULL;

-- ---------- Séances (une réunion permanente peut en avoir plusieurs) ---
-- Chaque séance porte son compte rendu.
CREATE TABLE IF NOT EXISTS meeting_sessions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id        UUID NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  room_sid          TEXT,
  started_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at          TIMESTAMPTZ,
  notes             TEXT,          -- compte rendu : résumé
  decisions         TEXT,          -- compte rendu : décisions
  actions           TEXT,          -- compte rendu : actions à mener
  notes_updated_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  notes_updated_at  TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_session_open ON meeting_sessions(meeting_id) WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_sessions_started ON meeting_sessions(started_at DESC);

-- ---------- Présences (arrivées et départs, envoyés par LiveKit) ------
CREATE TABLE IF NOT EXISTS attendance (
  id            BIGSERIAL PRIMARY KEY,
  session_id    UUID NOT NULL REFERENCES meeting_sessions(id) ON DELETE CASCADE,
  identity      TEXT NOT NULL,     -- u:<id utilisateur> ou g:<id invité>
  user_id       UUID REFERENCES users(id) ON DELETE SET NULL,
  guest_id      UUID REFERENCES guest_requests(id) ON DELETE SET NULL,
  display_name  TEXT NOT NULL,
  joined_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  left_at       TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_attendance_session ON attendance(session_id, identity);

-- ---------- Enregistrements (conservés par la DSID) -------------------
CREATE TABLE IF NOT EXISTS recordings (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  egress_id         TEXT UNIQUE,
  meeting_id        UUID REFERENCES meetings(id) ON DELETE SET NULL,
  session_id        UUID REFERENCES meeting_sessions(id) ON DELETE SET NULL,
  room_name         TEXT NOT NULL,
  title             TEXT NOT NULL,     -- copie du titre (survit à la réunion)
  kind              meeting_kind NOT NULL DEFAULT 'meeting',
  organizer_name    TEXT,
  status            recording_status NOT NULL DEFAULT 'recording',
  file_path         TEXT,
  size_bytes        BIGINT,
  duration_seconds  INTEGER,
  started_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at          TIMESTAMPTZ,
  error             TEXT
);
CREATE INDEX IF NOT EXISTS idx_recordings_started ON recordings(started_at DESC);

-- L'enregistrement devient systématique (réunions ET appels), réglable par la DSID
INSERT INTO settings (key, value) VALUES ('recording_allowed', 'true')
  ON CONFLICT (key) DO UPDATE SET value = 'true';

COMMIT;
