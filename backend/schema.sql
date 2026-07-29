-- ===========================================================================
-- SAT Monitoring — PostgreSQL schema
--
-- IDEMPOTENT: runs on every boot, so it must be safe to execute repeatedly.
-- Use CREATE ... IF NOT EXISTS and guarded ALTERs only.
--
-- Field ownership (enforced in backend/src/discovery/sync.js):
--   SERVER-OWNED  name, url, status, first_seen, last_seen, source,
--                 discovery_status, docker_state, health_status, url_source
--   ADMIN-OWNED   team, developed_by, gstack_implemented, decommissioned, notes
-- ===========================================================================

CREATE TABLE IF NOT EXISTS applications (
  id                 SERIAL PRIMARY KEY,
  name               TEXT        NOT NULL,
  url                TEXT,
  team               TEXT,
  developed_by       TEXT,
  status             TEXT        NOT NULL DEFAULT 'Active',
  decommissioned     BOOLEAN     NOT NULL DEFAULT FALSE,
  gstack_implemented BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS applications_name_key
  ON applications (lower(name));

-- ---------------------------------------------------------------------------
-- Discovery columns, added via ALTER so an existing database migrates in place.
-- ---------------------------------------------------------------------------
ALTER TABLE applications
  ADD COLUMN IF NOT EXISTS source           TEXT        NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS first_seen       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_seen        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS discovery_status TEXT        NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS notes            TEXT,
  ADD COLUMN IF NOT EXISTS container_key    TEXT,
  -- Raw Docker facts, kept verbatim for diagnosis rather than only the mapped
  -- portal status.
  ADD COLUMN IF NOT EXISTS docker_state     TEXT,
  ADD COLUMN IF NOT EXISTS health_status    TEXT,
  -- How the URL was established: 'label' | 'nginx' | NULL when unmapped.
  -- A NULL url means "Needs Mapping" — never a guessed hostname.
  ADD COLUMN IF NOT EXISTS url_source       TEXT,
  ADD COLUMN IF NOT EXISTS approved_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approved_by      TEXT;

ALTER TABLE applications ALTER COLUMN team DROP NOT NULL;
ALTER TABLE applications ALTER COLUMN developed_by DROP NOT NULL;
-- url becomes nullable: discovery must not invent a hostname it cannot verify.
ALTER TABLE applications ALTER COLUMN url DROP NOT NULL;

-- Widen the status check to include Warning (unhealthy container).
ALTER TABLE applications DROP CONSTRAINT IF EXISTS applications_status_check;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'applications_status_chk') THEN
    ALTER TABLE applications ADD CONSTRAINT applications_status_chk
      CHECK (status IN ('Active', 'Warning', 'Inactive'));
  END IF;
END $$;

-- Lifecycle of the DISCOVERY record itself, distinct from liveness.
ALTER TABLE applications DROP CONSTRAINT IF EXISTS applications_discovery_status_chk;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'applications_discovery_status_chk2'
  ) THEN
    ALTER TABLE applications ADD CONSTRAINT applications_discovery_status_chk2
      CHECK (discovery_status IN ('pending_review', 'active', 'inactive'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS applications_container_key_uidx
  ON applications (container_key) WHERE container_key IS NOT NULL;

-- Repair: an early migration defaulted `source` to 'docker', mislabelling
-- pre-existing manual rows. Only discovery sets container_key.
UPDATE applications SET source = 'manual'
 WHERE container_key IS NULL AND source = 'docker';

-- ---------------------------------------------------------------------------
-- Admins
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS admins (
  id       SERIAL PRIMARY KEY,
  email    TEXT        NOT NULL UNIQUE,
  added_by TEXT,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Notifications.
--
-- application_id is INTEGER, not UUID as originally specified, because
-- applications.id is SERIAL and a UUID column could not reference it. The
-- notification's own id is a UUID as specified.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notifications (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id INTEGER     NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  type           VARCHAR(50) NOT NULL,
  message        TEXT        NOT NULL,
  is_read        BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notifications_created_idx
  ON notifications (created_at DESC);

-- Spam guard: at most ONE unresolved outage notification per application,
-- enforced in the database so a concurrent pass cannot slip a second one past
-- the application-level check.
CREATE UNIQUE INDEX IF NOT EXISTS notifications_one_open_outage_uidx
  ON notifications (application_id)
  WHERE type = 'TOOL_STOPPED' AND is_read = FALSE;

-- ---------------------------------------------------------------------------
-- Audit trail. Append-only; never updated.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS application_events (
  id             SERIAL PRIMARY KEY,
  application_id INTEGER     NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  event_type     VARCHAR(64) NOT NULL,
  old_value      TEXT,
  new_value      TEXT,
  actor          TEXT        NOT NULL DEFAULT 'discovery',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS application_events_app_idx
  ON application_events (application_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Discovery run metrics. One row per pass, successful or not.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS discovery_runs (
  id                       SERIAL PRIMARY KEY,
  started_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at             TIMESTAMPTZ,
  trigger                  TEXT        NOT NULL DEFAULT 'scheduled',
  requested_by             TEXT,
  containers_scanned       INTEGER     NOT NULL DEFAULT 0,
  applications_discovered  INTEGER     NOT NULL DEFAULT 0,
  applications_updated     INTEGER     NOT NULL DEFAULT 0,
  applications_deactivated  INTEGER    NOT NULL DEFAULT 0,
  applications_reactivated  INTEGER    NOT NULL DEFAULT 0,
  needs_mapping            INTEGER     NOT NULL DEFAULT 0,
  errors                   TEXT,
  duration_ms              INTEGER
);

CREATE INDEX IF NOT EXISTS discovery_runs_started_idx
  ON discovery_runs (started_at DESC);
