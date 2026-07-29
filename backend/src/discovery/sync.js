import { pool } from '../db.js';
import { discover } from './discovery.js';

/**
 * Reconciles the applications table with what Docker currently reports.
 *
 * THE CENTRAL RULE: discovery writes ONLY server-owned columns —
 *   name, url, url_source, status, source, first_seen, last_seen,
 *   discovery_status, docker_state, health_status, container_key
 *
 * It must NEVER write an admin-owned column:
 *   team, developed_by, gstack_implemented, decommissioned, notes
 *
 * Every UPDATE below names its columns explicitly for that reason. Do not
 * replace them with a wholesale row update.
 *
 * Applications are never deleted and never auto-decommissioned — decommissioning
 * is a business decision only an admin can make.
 *
 * Concurrency: a Postgres ADVISORY LOCK serialises passes across every process,
 * so a scheduled pass and a manually requested one cannot run together even
 * when they are in different containers.
 */

/** Arbitrary but fixed key; any process using this key contends for the lock. */
const LOCK_KEY = 8412_7731;

const EVENT = {
  DISCOVERED: 'APPLICATION_DISCOVERED',
  INACTIVE: 'APPLICATION_INACTIVE',
  ACTIVE: 'APPLICATION_ACTIVE',
  WARNING: 'APPLICATION_WARNING',
};

const NOTIFY = {
  DISCOVERED: 'TOOL_DISCOVERED',
  STOPPED: 'TOOL_STOPPED',
  RESTORED: 'TOOL_RESTORED',
};

/** Raised when another process holds the discovery lock. */
export class DiscoveryBusyError extends Error {
  constructor() {
    super('Another discovery pass is already running.');
    this.name = 'DiscoveryBusyError';
  }
}

function fmt(ts) {
  if (!ts) return 'never';
  return new Date(ts).toISOString().slice(0, 16).replace('T', ' ');
}

async function recordEvent(client, applicationId, eventType, oldValue, newValue) {
  await client.query(
    `INSERT INTO application_events (application_id, event_type, old_value, new_value, actor)
     VALUES ($1, $2, $3, $4, 'discovery')`,
    [applicationId, eventType, oldValue, newValue]
  );
}

/**
 * Raise a notification. Outage notifications are deduplicated by a partial
 * unique index, so ON CONFLICT DO NOTHING turns a race into a no-op.
 */
async function notify(client, applicationId, type, message) {
  await client.query(
    `INSERT INTO notifications (application_id, type, message)
     VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
    [applicationId, type, message]
  );
}

/**
 * Clearing the open outage on recovery is what allows the NEXT outage to raise a
 * fresh notification — the unique index permits only one unread TOOL_STOPPED.
 */
async function resolveOutage(client, applicationId) {
  await client.query(
    `UPDATE notifications SET is_read = TRUE
      WHERE application_id = $1 AND type = $2 AND is_read = FALSE`,
    [applicationId, NOTIFY.STOPPED]
  );
}

/**
 * Run one discovery pass.
 *
 * @param {{trigger?: string, requestedBy?: string}} opts
 * @throws {DiscoveryBusyError} when another pass holds the lock
 */
export async function runSync({ trigger = 'scheduled', requestedBy = null } = {}) {
  const client = await pool.connect();
  let haveLock = false;
  let runId = null;
  const startedAt = new Date();

  const stats = {
    scanned: 0,
    seen: 0,
    created: 0,
    activated: 0,
    deactivated: 0,
    unchanged: 0,
    needsMapping: 0,
    pendingReview: 0,
  };

  try {
    // Session-level advisory lock; non-blocking so a caller learns immediately
    // rather than queueing behind a slow pass.
    const lock = await client.query('SELECT pg_try_advisory_lock($1) AS ok', [LOCK_KEY]);
    haveLock = lock.rows[0].ok === true;
    if (!haveLock) throw new DiscoveryBusyError();

    const run = await client.query(
      `INSERT INTO discovery_runs (started_at, trigger, requested_by)
       VALUES ($1, $2, $3) RETURNING id`,
      [startedAt, trigger, requestedBy]
    );
    runId = run.rows[0].id;

    const { apps: found, scanned, nginx } = await discover();
    stats.scanned = scanned;
    stats.seen = found.length;

    await client.query('BEGIN');

    // Lock the discovered rows so two passes cannot both decide the same
    // application just went down. (Belt and braces: the advisory lock already
    // serialises passes; this also guards against manual SQL.)
    const { rows: existing } = await client.query(
      `SELECT id, name, url, url_source, status, discovery_status, container_key,
              last_seen, decommissioned
         FROM applications
        WHERE source = 'docker'
        FOR UPDATE`
    );

    const byKey = new Map(existing.filter((r) => r.container_key).map((r) => [r.container_key, r]));
    const foundKeys = new Set(found.map((f) => f.containerKey));

    for (const app of found) {
      const row = byKey.get(app.containerKey);

      // Count only applications that end up with NO url at all. A container
      // discovery cannot map is not "needing mapping" if the stored row already
      // has a URL (from a label that has since been removed, or set by an admin).
      if (!app.url && !row?.url) stats.needsMapping += 1;

      // --- NEW: created pending an admin's review ---------------------------
      if (!row) {
        const inserted = await client.query(
          `INSERT INTO applications
             (name, url, url_source, status, source, container_key, first_seen,
              last_seen, discovery_status, docker_state, health_status)
           VALUES ($1, $2, $3, $4, 'docker', $5, now(), now(), 'pending_review', $6, $7)
           ON CONFLICT (lower(name)) DO NOTHING
           RETURNING id`,
          [app.name, app.url, app.urlSource, app.status, app.containerKey,
            app.dockerState, app.healthStatus]
        );

        if (inserted.rows.length === 0) {
          // A manually-created application already owns this name. Adopt it
          // rather than creating a duplicate, and leave its metadata untouched.
          const adopted = await client.query(
            `UPDATE applications
                SET container_key = $1, source = 'docker',
                    first_seen = COALESCE(first_seen, now()), last_seen = now(),
                    status = $2, docker_state = $3, health_status = $4,
                    url = COALESCE(url, $5),
                    url_source = COALESCE(url_source, $6),
                    updated_at = now()
              WHERE lower(name) = lower($7) AND container_key IS NULL
            RETURNING id`,
            [app.containerKey, app.status, app.dockerState, app.healthStatus,
              app.url, app.urlSource, app.name]
          );
          if (adopted.rows.length > 0) {
            await recordEvent(client, adopted.rows[0].id, EVENT.DISCOVERED, null, app.url);
            stats.created += 1;
          }
          continue;
        }

        const id = inserted.rows[0].id;
        await recordEvent(client, id, EVENT.DISCOVERED, null, app.url || '(needs mapping)');
        await notify(
          client, id, NOTIFY.DISCOVERED,
          `New tool discovered\n\nApplication:\n${app.name}\n\n` +
            `URL:\n${app.url || 'Not mapped — no sat.url label and no nginx route found'}\n\n` +
            `Action Required:\nReview and approve, then set Team Using, Developed By and Gstack.`
        );
        stats.created += 1;
        stats.pendingReview += 1;
        continue;
      }

      // --- EXISTING: refresh liveness only ---------------------------------
      const wasDown = row.status === 'Inactive';
      const nowDown = app.status === 'Inactive';

      // A pending application stays pending; approval is an admin action.
      const nextDiscoveryStatus =
        row.discovery_status === 'pending_review'
          ? 'pending_review'
          : nowDown
            ? 'inactive'
            : 'active';

      if (!nowDown && wasDown) {
        await client.query(
          `UPDATE applications
              SET status = $2, discovery_status = $3, last_seen = now(),
                  docker_state = $4, health_status = $5,
                  url = COALESCE($6, url), url_source = COALESCE($7, url_source),
                  updated_at = now()
            WHERE id = $1`,
          [row.id, app.status, nextDiscoveryStatus, app.dockerState, app.healthStatus,
            app.url, app.urlSource]
        );
        await recordEvent(client, row.id, EVENT.ACTIVE, 'Inactive', app.status);
        await resolveOutage(client, row.id);
        await notify(
          client, row.id, NOTIFY.RESTORED,
          `Tool restored\n\nApplication:\n${row.name}\n\nURL:\n${app.url || row.url || '—'}`
        );
        stats.activated += 1;
      } else if (nowDown && !wasDown) {
        await client.query(
          `UPDATE applications
              SET status = 'Inactive', discovery_status = $2, docker_state = $3,
                  health_status = $4, updated_at = now()
            WHERE id = $1`,
          [row.id, nextDiscoveryStatus, app.dockerState, app.healthStatus]
        );
        await recordEvent(client, row.id, EVENT.INACTIVE, row.status, 'Inactive');
        await notify(
          client, row.id, NOTIFY.STOPPED,
          `Tool stopped\n\nApplication:\n${row.name}\n\nURL:\n${row.url || '—'}\n\n` +
            `Last Seen:\n${fmt(row.last_seen)}\n\nAction Required:\nReview application status.`
        );
        stats.deactivated += 1;
      } else {
        // Steady state, including Active <-> Warning transitions.
        if (row.status !== app.status) {
          await recordEvent(client, row.id, EVENT.WARNING, row.status, app.status);
        }
        await client.query(
          `UPDATE applications
              SET status = $2,
                  last_seen = CASE WHEN $3 THEN now() ELSE last_seen END,
                  discovery_status = $4, docker_state = $5, health_status = $6,
                  url = COALESCE($7, url), url_source = COALESCE($8, url_source),
                  updated_at = now()
            WHERE id = $1`,
          [row.id, app.status, !nowDown, nextDiscoveryStatus, app.dockerState,
            app.healthStatus, app.url, app.urlSource]
        );
        stats.unchanged += 1;
      }
    }

    // --- Applications whose container has disappeared entirely -------------
    for (const row of existing) {
      if (!row.container_key || foundKeys.has(row.container_key)) continue;
      if (row.status === 'Inactive') continue; // already reported

      await client.query(
        `UPDATE applications
            SET status = 'Inactive',
                discovery_status = CASE WHEN discovery_status = 'pending_review'
                                        THEN 'pending_review' ELSE 'inactive' END,
                docker_state = 'absent', updated_at = now()
          WHERE id = $1`,
        [row.id]
      );
      await recordEvent(client, row.id, EVENT.INACTIVE, row.status, 'Inactive');
      await notify(
        client, row.id, NOTIFY.STOPPED,
        `Tool stopped\n\nApplication:\n${row.name}\n\nURL:\n${row.url || '—'}\n\n` +
          `Last Seen:\n${fmt(row.last_seen)}\n\nAction Required:\nReview application status.`
      );
      stats.deactivated += 1;
    }

    await client.query(
      `UPDATE discovery_runs
          SET completed_at = now(), containers_scanned = $2,
              applications_discovered = $3, applications_updated = $4,
              applications_deactivated = $5, applications_reactivated = $6,
              needs_mapping = $7, duration_ms = $8
        WHERE id = $1`,
      [runId, stats.scanned, stats.created, stats.unchanged, stats.deactivated,
        stats.activated, stats.needsMapping, Date.now() - startedAt.getTime()]
    );

    await client.query('COMMIT');
    return { ...stats, runId, nginx };
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* no transaction open */
    }
    // Record the failure outside the rolled-back transaction so the run is
    // still visible in the metrics.
    if (runId && !(err instanceof DiscoveryBusyError)) {
      try {
        await client.query(
          `UPDATE discovery_runs
              SET completed_at = now(), errors = $2,
                  duration_ms = $3
            WHERE id = $1`,
          [runId, String(err.message).slice(0, 1000), Date.now() - startedAt.getTime()]
        );
      } catch {
        /* metrics are best-effort */
      }
    }
    throw err;
  } finally {
    if (haveLock) {
      try {
        await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]);
      } catch {
        // The lock is session-scoped, so releasing the connection drops it too.
      }
    }
    client.release();
  }
}

/** The most recent run's id, or 0 when none has happened. */
export async function latestRunId() {
  const { rows } = await pool.query('SELECT COALESCE(max(id), 0) AS id FROM discovery_runs');
  return Number(rows[0].id);
}

/**
 * Wait for a run newer than `afterId` to finish, and return it.
 *
 * Lets the API report a real outcome for a manually triggered scan even though
 * the work happens in the worker process: it asks, then watches the run table.
 * Returns null on timeout rather than hanging.
 */
export async function waitForRunAfter(afterId, timeoutMs = 20_000, pollMs = 400) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { rows } = await pool.query(
      `SELECT id FROM discovery_runs
        WHERE id > $1 AND completed_at IS NOT NULL
        ORDER BY id DESC LIMIT 1`,
      [afterId]
    );
    if (rows.length > 0) {
      const [run] = await getRecentRuns(1);
      // getRecentRuns returns the newest overall, which is the one we just saw.
      if (run && run.id > afterId) return run;
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
  return null;
}

/** Latest runs, newest first — surfaced on the dashboard. */
export async function getRecentRuns(limit = 10) {
  const { rows } = await pool.query(
    `SELECT id, started_at, completed_at, trigger, requested_by,
            containers_scanned, applications_discovered, applications_updated,
            applications_deactivated, applications_reactivated, needs_mapping,
            errors, duration_ms
       FROM discovery_runs
      ORDER BY started_at DESC
      LIMIT $1`,
    [Math.min(Math.max(limit, 1), 100)]
  );
  return rows.map((r) => ({
    id: r.id,
    startedAt: r.started_at,
    completedAt: r.completed_at,
    trigger: r.trigger,
    requestedBy: r.requested_by,
    containersScanned: r.containers_scanned,
    applicationsDiscovered: r.applications_discovered,
    applicationsUpdated: r.applications_updated,
    applicationsDeactivated: r.applications_deactivated,
    applicationsReactivated: r.applications_reactivated,
    needsMapping: r.needs_mapping,
    errors: r.errors,
    durationMs: r.duration_ms,
    ok: Boolean(r.completed_at) && !r.errors,
  }));
}

export { EVENT, NOTIFY, LOCK_KEY };
