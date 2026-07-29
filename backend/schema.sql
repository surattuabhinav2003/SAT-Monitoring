-- ===========================================================================
-- SAT Monitoring — PostgreSQL schema
--
-- This file is IDEMPOTENT: it runs on every API boot, so it must be safe to
-- execute repeatedly. Use CREATE ... IF NOT EXISTS and guarded ALTERs only.
--
-- Field ownership (enforced in code, see backend/src/discovery/sync.js):
--   SERVER-OWNED  name, url, status, first_seen, last_seen, source,
--                 discovery_status  -- written by Docker discovery
--   ADMIN-OWNED   team, developed_by, gstack_implemented, decommissioned,
--                 notes             -- discovery must NEVER touch these
-- ===========================================================================

CREATE TABLE IF NOT EXISTS applications (
  id                 SERIAL PRIMARY KEY,
  name               TEXT        NOT NULL,
  url                TEXT        NOT NULL,
  team               TEXT,
  developed_by       TEXT,
  status             TEXT        NOT NULL DEFAULT 'Active'
                                 CHECK (status IN ('Active', 'Inactive')),
  decommissioned     BOOLEAN     NOT NULL DEFAULT FALSE,
  gstack_implemented BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Two applications should not share a name; the portal is a single inventory.
CREATE UNIQUE INDEX IF NOT EXISTS applications_name_key
  ON applications (lower(name));

-- ---------------------------------------------------------------------------
-- Discovery columns.
--
-- Added via ALTER so an existing database migrates in place. team and
-- developed_by are also relaxed to NULL: a freshly discovered application has
-- no business metadata until an admin fills it in.
-- ---------------------------------------------------------------------------
ALTER TABLE applications
  -- Defaults to 'manual' so rows that predate discovery are labelled honestly;
  -- the discovery service writes 'docker' explicitly on the rows it creates.
  ADD COLUMN IF NOT EXISTS source           TEXT        NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS first_seen       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_seen        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS discovery_status TEXT        NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS notes            TEXT,
  -- Stable identity for a discovered container, independent of its display
  -- name, so renaming a container does not create a duplicate application.
  ADD COLUMN IF NOT EXISTS container_key    TEXT;

ALTER TABLE applications ALTER COLUMN team DROP NOT NULL;
ALTER TABLE applications ALTER COLUMN developed_by DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'applications_discovery_status_chk'
  ) THEN
    ALTER TABLE applications
      ADD CONSTRAINT applications_discovery_status_chk
      CHECK (discovery_status IN ('active', 'inactive'));
  END IF;
END $$;

-- One application per discovered container.
CREATE UNIQUE INDEX IF NOT EXISTS applications_container_key_uidx
  ON applications (container_key) WHERE container_key IS NOT NULL;

-- Repair: an earlier migration defaulted `source` to 'docker', which mislabelled
-- pre-existing manual rows. Only discovery sets container_key, so a row without
-- one was never discovered. Idempotent.
UPDATE applications
   SET source = 'manual'
 WHERE container_key IS NULL AND source = 'docker';

-- ---------------------------------------------------------------------------
-- Admins — who holds the Admin role. Emails are stored lower-cased by the API.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS admins (
  id       SERIAL PRIMARY KEY,
  email    TEXT        NOT NULL UNIQUE,
  added_by TEXT,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Notifications raised by discovery (tool stopped / restored / discovered).
--
-- NOTE: application_id is INTEGER, not UUID as originally specified, because
-- applications.id is SERIAL — a UUID column could not reference it. The
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

-- Spam guard: at most ONE unresolved outage notification per application.
-- Enforced in the database so a concurrent sync cannot slip a second one past
-- the application-level check.
CREATE UNIQUE INDEX IF NOT EXISTS notifications_one_open_outage_uidx
  ON notifications (application_id)
  WHERE type = 'TOOL_STOPPED' AND is_read = FALSE;

-- ---------------------------------------------------------------------------
-- Audit trail for every status transition. Append-only; never updated.
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
