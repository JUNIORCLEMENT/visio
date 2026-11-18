-- =====================================================================
--  HPO Visio — schéma PostgreSQL (version 16+)
--  Exécuté automatiquement au premier démarrage du conteneur « db ».
--  Hors Docker :  psql -U postgres -d hpo_visio -f 01-schema.sql
-- =====================================================================

BEGIN;

-- ---------- Types -----------------------------------------------------
CREATE TYPE user_role         AS ENUM ('admin', 'organizer', 'user');
CREATE TYPE user_status       AS ENUM ('active', 'disabled');
CREATE TYPE invitation_status AS ENUM ('pending', 'accepted', 'revoked', 'replaced');
CREATE TYPE meeting_status    AS ENUM ('scheduled', 'live', 'ended');
CREATE TYPE guest_status      AS ENUM ('waiting', 'admitted', 'denied');

-- Met à jour la colonne updated_at à chaque modification
CREATE FUNCTION touch_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

-- ---------- Annuaire HPO Mail (fournisseur « db ») ---------------------
-- Rempli par import CSV (npm run import:annuaire ou écran Admin).
-- Inutilisé si DIRECTORY_PROVIDER=ldap : l'annuaire est alors lu en direct.
CREATE TABLE directory_entries (
  email       TEXT PRIMARY KEY CHECK (email = lower(email) AND email LIKE '%@%'),
  full_name   TEXT NOT NULL,
  department  TEXT,
  job_title   TEXT,
  site        TEXT,
  company     TEXT,                       -- filiale (TRYAM, SOGADA, SGTP…)
  active      BOOLEAN NOT NULL DEFAULT true,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_directory_touch BEFORE UPDATE ON directory_entries
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ---------- Comptes HPO Visio ------------------------------------------
CREATE TABLE users (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email              TEXT NOT NULL UNIQUE CHECK (email = lower(email)),
  full_name          TEXT NOT NULL,
  department         TEXT,
  job_title          TEXT,
  site               TEXT,
  company            TEXT,
  role               user_role   NOT NULL DEFAULT 'user',
  status             user_status NOT NULL DEFAULT 'active',
  password_hash      TEXT,                -- seulement si AUTH_PROVIDER=local
  last_login_at      TIMESTAMPTZ,
  last_login_origin  TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_users_touch BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ---------- Invitations envoyées sur HPO Mail --------------------------
-- Le jeton n'est jamais stocké en clair : seulement son empreinte SHA-256.
CREATE TABLE invitations (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email        TEXT NOT NULL CHECK (email = lower(email)),
  role         user_role NOT NULL DEFAULT 'user',
  token_hash   TEXT NOT NULL UNIQUE,
  status       invitation_status NOT NULL DEFAULT 'pending',
  ttl_hours    INTEGER NOT NULL CHECK (ttl_hours BETWEEN 1 AND 720),
  expires_at   TIMESTAMPTZ NOT NULL,
  invited_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  user_id      UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  accepted_at  TIMESTAMPTZ
);
-- Une seule invitation en attente par adresse
CREATE UNIQUE INDEX uq_invitation_pending_email ON invitations(email) WHERE status = 'pending';
CREATE INDEX idx_invitations_created ON invitations(created_at DESC);

-- ---------- Réinitialisation de mot de passe (AUTH_PROVIDER=local) -----
CREATE TABLE password_resets (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- Double authentification (code à 6 chiffres par e-mail) ----
CREATE TABLE login_challenges (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash    TEXT NOT NULL,
  attempts     INTEGER NOT NULL DEFAULT 0,
  expires_at   TIMESTAMPTZ NOT NULL,
  consumed_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_challenges_user ON login_challenges(user_id);

-- ---------- Réunions et salles permanentes -----------------------------
CREATE TABLE meetings (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code               TEXT NOT NULL UNIQUE,          -- ex. hpo-482-913 (= nom de la salle LiveKit)
  title              TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 160),
  description        TEXT,
  department         TEXT,
  organizer_id       UUID REFERENCES users(id) ON DELETE SET NULL,
  is_permanent       BOOLEAN NOT NULL DEFAULT false,
  scheduled_start    TIMESTAMPTZ,
  scheduled_end      TIMESTAMPTZ,
  allow_guests       BOOLEAN NOT NULL DEFAULT true,
  waiting_room       BOOLEAN NOT NULL DEFAULT true,
  recording_allowed  BOOLEAN NOT NULL DEFAULT false,
  status             meeting_status NOT NULL DEFAULT 'scheduled',
  started_at         TIMESTAMPTZ,
  ended_at           TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (scheduled_end IS NULL OR scheduled_start IS NULL OR scheduled_end > scheduled_start)
);
CREATE INDEX idx_meetings_start ON meetings(scheduled_start);
CREATE INDEX idx_meetings_status ON meetings(status);

-- Collaborateurs conviés à une réunion (pour « Mes réunions »)
CREATE TABLE meeting_invitees (
  meeting_id  UUID NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (meeting_id, user_id)
);

-- ---------- Invités externes et salle d'attente ------------------------
CREATE TABLE guest_requests (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id    UUID NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  display_name  TEXT NOT NULL CHECK (length(display_name) BETWEEN 2 AND 80),
  organization  TEXT CHECK (organization IS NULL OR length(organization) <= 120),
  secret_hash   TEXT NOT NULL,
  status        guest_status NOT NULL DEFAULT 'waiting',
  decided_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at    TIMESTAMPTZ
);
CREATE INDEX idx_guest_requests_meeting ON guest_requests(meeting_id, status);

-- ---------- Discussion pendant la réunion ------------------------------
CREATE TABLE chat_messages (
  id           BIGSERIAL PRIMARY KEY,
  meeting_id   UUID NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  user_id      UUID REFERENCES users(id) ON DELETE SET NULL,
  guest_id     UUID REFERENCES guest_requests(id) ON DELETE SET NULL,
  sender_name  TEXT NOT NULL,
  body         TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 2000),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_chat_meeting ON chat_messages(meeting_id, id);

-- ---------- Journal d'activité ----------------------------------------
CREATE TABLE audit_logs (
  id           BIGSERIAL PRIMARY KEY,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_label  TEXT NOT NULL,
  action       TEXT NOT NULL,
  target       TEXT,
  details      JSONB,
  ip           TEXT,
  origin       TEXT                        -- « Réseau interne » ou « Internet »
);
CREATE INDEX idx_audit_created ON audit_logs(created_at DESC);

-- ---------- Règles de sécurité (écran Admin > Sécurité) ----------------
CREATE TABLE settings (
  key         TEXT PRIMARY KEY,
  value       JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  UUID REFERENCES users(id) ON DELETE SET NULL
);

INSERT INTO settings (key, value) VALUES
  ('allow_guests',              'true'),   -- invités externes autorisés
  ('guest_waiting_room',        'true'),   -- salle d'attente obligatoire pour les invités
  ('admin_2fa',                 'true'),   -- code de vérification pour les administrateurs
  ('external_2fa',              'false'),  -- code pour tous depuis l'extérieur du réseau interne
  ('recording_allowed',         'true'),   -- enregistrement automatique des réunions et appels
  ('recording_retention_days',  '90'),
  ('invitation_default_ttl',    '72');     -- heures

COMMIT;
