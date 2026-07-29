import { pool } from '../db.js';
import { discover } from './discovery.js';

/**
 * Reconciles the applications table with what Docker currently reports.
 *
 * THE CENTRAL RULE: discovery writes ONLY server-owned columns —
 *   name, url, status, source, first_seen, last_seen, discovery_status,
 *   container_key
 *
 * It must NEVER write an admin-owned column:
 *   team, developed_by, gstack_implemented, decommissioned, notes
 *
 * Every UPDATE below names its columns explicitly for that reason. Do not
 * replace them with a wholesale row update.
 *
 * Applications are never deleted and never auto-decommissioned —
 * decommissioning is a business decision that only an admin can make.
 */

const EVENT = {
  DISCOVERED: 'APPLICATION_DISCOVERED',
  INACTIVE: 'APPLICATION_INACTIVE',
  ACTIVE: 'APPLICATION_ACTIVE',
};

const NOTIFY = {
  DISCOVERED: 'TOOL_DISCOVERED',
  STOPPED: 'TOOL_STOPPED',
  RESTORED: 'TOOL_RESTORED',
};

function fmt(ts) {
  if (!ts) return 'never';
  return new Date(ts).toISOString().slice(0, 16).replace('T', ' ');
}

async function recordEvent(client, applicationId, eventType, oldValue, newValue) {
  await client.query(
    `INSERT INTO application_events
       (application_id, event_type, old_value, new_value, actor)
     VALUES ($1, $2, $3, $4, 'discovery')`,
    [applicationId, eventType, oldValue, newValue]
  );
}

/**
 * Raise a notification.
 *
 * Outage notifications are deduplicated by a partial unique index (one unread
 * TOOL_STOPPED per application), so a concurrent sync cannot create a second
 * one. ON CONFLICT DO NOTHING turns that race into a no-op instead of an error.
 */
async function notify(client, applicationId, type, message) {
  await client.query(
    `INSERT INTO notifications (application_id, type, message)
     VALUES ($1, $2, $3)
     ON CONFLICT DO NOTHING`,
    [applicationId, type, message]
  );
}

/**
 * Clearing the open outage notification on recovery is what allows the next
 * outage to raise a fresh one — the unique index only permits one UNREAD
 * TOOL_STOPPED per application.
 */
async function resolveOutage(client, applicationId) {
  await client.query(
    `UPDATE notifications
        SET is_read = TRUE
      WHERE application_id = $1
        AND type = $2
        AND is_read = FALSE`,
    [applicationId, NOTIFY.STOPPED]
  );
}

/**
 * Run one discovery pass.
 * @returns {Promise<{created:number, activated:number, deactivated:number, unchanged:number, seen:number}>}
 */
export async function runSync() {
  const found = await discover();
  const stats = { seen: found.length, created: 0, activated: 0, deactivated: 0, unchanged: 0 };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Lock the discovered rows for the duration so two overlapping passes cannot
    // both decide the same application just went down.
    const { rows: existing } = await client.query(
      `SELECT id, name, url, status, discovery_status, container_key, last_seen,
              decommissioned
         FROM applications
        WHERE source = 'docker'
        FOR UPDATE`
    );

    const byKey = new Map(
      existing.filter((r) => r.container_key).map((r) => [r.container_key, r])
    );
    const foundKeys = new Set(found.map((f) => f.containerKey));

    // --- Containers Docker currently reports -------------------------------
    for (const app of found) {
      const row = byKey.get(app.containerKey);

      // NEW APPLICATION: create with server-owned fields only. Admin-owned
      // columns are left NULL/default for an admin to complete.
      if (!row) {
        const inserted = await client.query(
          `INSERT INTO applications
             (name, url, status, source, container_key, first_seen, last_seen,
              discovery_status)
           VALUES ($1, $2, $3, 'docker', $4, now(), now(), $5)
           ON CONFLICT (lower(name)) DO NOTHING
           RETURNING id`,
          [
            app.name,
            app.url,
            app.status,
            app.containerKey,
            app.status === 'Active' ? 'active' : 'inactive',
          ]
        );

        if (inserted.rows.length === 0) {
          // A manually-created application already owns this name. Adopt it by
          // attaching the container key rather than creating a duplicate.
          const adopted = await client.query(
            `UPDATE applications
                SET container_key = $1,
                    source = 'docker',
                    first_seen = COALESCE(first_seen, now()),
                    last_seen = now(),
                    status = $2,
                    discovery_status = $3,
                    updated_at = now()
              WHERE lower(name) = lower($4) AND container_key IS NULL
            RETURNING id`,
            [
              app.containerKey,
              app.status,
              app.status === 'Active' ? 'active' : 'inactive',
              app.name,
            ]
          );
          if (adopted.rows.length > 0) {
            await recordEvent(client, adopted.rows[0].id, EVENT.DISCOVERED, null, app.url);
            stats.created += 1;
          }
          continue;
        }

        const id = inserted.rows[0].id;
        await recordEvent(client, id, EVENT.DISCOVERED, null, app.url);
        await notify(
          client,
          id,
          NOTIFY.DISCOVERED,
          `New tool discovered\n\nApplication:\n${app.name}\n\nURL:\n${app.url}\n\n` +
            `Action Required:\nSet Team Using, Developed By and Gstack.`
        );
        stats.created += 1;
        continue;
      }

      // EXISTING APPLICATION: refresh liveness only.
      const wasInactive = row.status === 'Inactive';
      const nowActive = app.status === 'Active';

      if (nowActive && wasInactive) {
        // RECOVERY
        await client.query(
          `UPDATE applications
              SET status = 'Active', discovery_status = 'active',
                  last_seen = now(), url = $2, updated_at = now()
            WHERE id = $1`,
          [row.id, app.url]
        );
        await recordEvent(client, row.id, EVENT.ACTIVE, 'Inactive', 'Active');
        await resolveOutage(client, row.id);
        await notify(
          client,
          row.id,
          NOTIFY.RESTORED,
          `Tool restored\n\nApplication:\n${row.name}\n\nURL:\n${app.url}`
        );
        stats.activated += 1;
      } else if (!nowActive && !wasInactive) {
        // Container exists but is stopped/exited — same outcome as missing.
        await client.query(
          `UPDATE applications
              SET status = 'Inactive', discovery_status = 'inactive',
                  updated_at = now()
            WHERE id = $1`,
          [row.id]
        );
        await recordEvent(client, row.id, EVENT.INACTIVE, 'Active', 'Inactive');
        await notify(
          client,
          row.id,
          NOTIFY.STOPPED,
          `Tool stopped\n\nApplication:\n${row.name}\n\nURL:\n${row.url}\n\n` +
            `Last Seen:\n${fmt(row.last_seen)}\n\nAction Required:\nReview application status.`
        );
        stats.deactivated += 1;
      } else {
        // Steady state. last_seen only advances while the tool is actually up,
        // so an outage notification can report when it was last healthy.
        await client.query(
          `UPDATE applications
              SET last_seen = CASE WHEN $2 THEN now() ELSE last_seen END,
                  url = $3, updated_at = now()
            WHERE id = $1`,
          [row.id, nowActive, app.url]
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
            SET status = 'Inactive', discovery_status = 'inactive', updated_at = now()
          WHERE id = $1`,
        [row.id]
      );
      await recordEvent(client, row.id, EVENT.INACTIVE, 'Active', 'Inactive');
      await notify(
        client,
        row.id,
        NOTIFY.STOPPED,
        `Tool stopped\n\nApplication:\n${row.name}\n\nURL:\n${row.url}\n\n` +
          `Last Seen:\n${fmt(row.last_seen)}\n\nAction Required:\nReview application status.`
      );
      stats.deactivated += 1;
    }

    await client.query('COMMIT');
    return stats;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export { EVENT, NOTIFY };
