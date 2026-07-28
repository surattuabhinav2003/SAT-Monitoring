import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Pool } = pg;

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = join(__dirname, '..', 'schema.sql');

if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is not set. Copy .env.example to .env and fill it in.'
  );
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
});

/** Convenience wrapper so routes never touch the pool directly. */
export function query(text, params) {
  return pool.query(text, params);
}

/**
 * Wait for Postgres to accept connections.
 *
 * In Docker the API can start before the database finishes initialising, so a
 * plain connect would fail on a cold `docker compose up`. Retry with a short
 * backoff rather than crash-looping the container.
 */
async function waitForDatabase(attempts = 15, delayMs = 2000) {
  for (let i = 1; i <= attempts; i += 1) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch (err) {
      if (i === attempts) throw err;
      console.log(
        `[db] not ready (attempt ${i}/${attempts}): ${err.message} — retrying…`
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

/**
 * Ensure there is always at least one admin, otherwise nobody could ever grant
 * access. Guarded on the specific email, so revoking a DIFFERENT admin is not
 * undone on the next boot.
 */
async function seedAdmin() {
  const email = (process.env.SEED_ADMIN_EMAIL || '').trim().toLowerCase();
  if (!email) {
    console.log('[db] SEED_ADMIN_EMAIL not set — skipping bootstrap admin.');
    return;
  }

  const { rowCount } = await pool.query(
    `INSERT INTO admins (email, added_by)
     VALUES ($1, 'system')
     ON CONFLICT (email) DO NOTHING`,
    [email]
  );

  console.log(
    rowCount > 0
      ? `[db] bootstrap admin created: ${email}`
      : `[db] bootstrap admin already present: ${email}`
  );
}

/** Apply the schema and seed. Safe to run on every boot. */
export async function initDatabase() {
  await waitForDatabase();
  const schema = await readFile(SCHEMA_PATH, 'utf8');
  await pool.query(schema);
  console.log('[db] schema applied');
  await seedAdmin();
}
