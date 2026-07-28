-- ===========================================================================
-- SAT Monitoring — PostgreSQL schema
--
-- This file is IDEMPOTENT: it runs on every API boot, so it must be safe to
-- execute repeatedly. Use CREATE ... IF NOT EXISTS and guarded inserts only.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS applications (
  id                 SERIAL PRIMARY KEY,
  name               TEXT        NOT NULL,
  url                TEXT        NOT NULL,
  team               TEXT        NOT NULL,
  developed_by       TEXT        NOT NULL,
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

-- Who holds the Admin role. Emails are stored lower-cased by the API.
CREATE TABLE IF NOT EXISTS admins (
  id       SERIAL PRIMARY KEY,
  email    TEXT        NOT NULL UNIQUE,
  added_by TEXT,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Bootstrap admin.
--
-- Without at least one admin nobody can grant access, so the address in
-- SEED_ADMIN_EMAIL is inserted once. The API passes it as $1; the guard makes
-- re-running harmless and never overwrites a revocation of a DIFFERENT email.
-- ---------------------------------------------------------------------------
-- (executed separately by db.js — see seedAdmin)
