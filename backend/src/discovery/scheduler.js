import cron from 'node-cron';
import { pool } from '../db.js';
import { runSync, DiscoveryBusyError, getRecentRuns } from './sync.js';
import { ping } from './docker.js';

/**
 * Periodic Docker discovery, plus an on-demand channel.
 *
 * The API has NO Docker access by design, so it cannot run a pass itself. It
 * asks the worker instead, over a Postgres LISTEN/NOTIFY channel:
 *
 *   API:    NOTIFY sat_discovery_run, '<requester>'
 *   worker: LISTEN sat_discovery_run  ->  runs a pass
 *
 * Postgres is already a shared dependency, so this adds no network surface, no
 * inter-service credentials, and nothing for an attacker to reach.
 */

const SCHEDULE = process.env.DISCOVERY_CRON || '*/5 * * * *';
export const CHANNEL = 'sat_discovery_run';
export const DISCOVERY_ENABLED =
  String(process.env.DISCOVERY_ENABLED ?? 'false').toLowerCase() === 'true';

let running = false;
let task = null;
let listener = null;
let last = null;

export function getDiscoveryState() {
  return { enabled: DISCOVERY_ENABLED, schedule: SCHEDULE, running, last };
}

/**
 * Run one pass.
 *
 * Overlap is prevented by a Postgres advisory lock inside runSync, which works
 * across processes; the local flag only avoids a pointless round trip.
 *
 * @returns stats, or null when a pass was already in flight
 * @throws on genuine failure (e.g. unreachable Docker socket)
 */
export async function runOnce(trigger = 'manual', requestedBy = null) {
  if (running) {
    console.log(`[discovery] ${trigger} pass skipped — already running in this process`);
    return null;
  }

  running = true;
  const startedAt = new Date();
  try {
    const stats = await runSync({ trigger, requestedBy });
    last = { at: startedAt.toISOString(), trigger, ok: true, ...stats };
    console.log(
      `[discovery] ${trigger}: scanned ${stats.scanned}, ${stats.seen} group(s) — ` +
        `${stats.created} new, ${stats.activated} restored, ${stats.deactivated} stopped, ` +
        `${stats.unchanged} unchanged, ${stats.needsMapping} needing mapping`
    );
    return stats;
  } catch (err) {
    if (err instanceof DiscoveryBusyError) {
      console.log(`[discovery] ${trigger} pass skipped — another process holds the lock`);
      return null;
    }
    last = { at: startedAt.toISOString(), trigger, ok: false, error: err.message };
    console.error(`[discovery] ${trigger} pass failed: ${err.message}`);
    throw err;
  } finally {
    running = false;
  }
}

/** Scheduled/startup wrapper: a failure must never crash the process. */
async function runQuietly(trigger, requestedBy = null) {
  try {
    await runOnce(trigger, requestedBy);
  } catch {
    // Already logged; the next tick retries.
  }
}

/**
 * Ask whichever process owns Docker to run a pass now.
 *
 * Called by the API. Returns immediately — the caller polls the run history for
 * the outcome, because the work happens in another container.
 */
export async function requestRun(requestedBy = 'unknown') {
  // pg_notify is the function form of NOTIFY and takes the payload as a
  // parameter, so the requester's email is never interpolated into SQL.
  await pool.query('SELECT pg_notify($1, $2)', [CHANNEL, String(requestedBy).slice(0, 200)]);
  return { requested: true };
}

/** Dedicated connection for LISTEN — it must not be returned to the pool. */
async function startListener() {
  const client = await pool.connect();
  listener = client;

  client.on('notification', (msg) => {
    if (msg.channel !== CHANNEL) return;
    const requester = msg.payload || 'unknown';
    console.log(`[discovery] run requested by ${requester}`);
    runQuietly('manual', requester);
  });

  client.on('error', (err) => {
    console.error(`[discovery] listener connection error: ${err.message}`);
    // Drop it and reconnect shortly; the cron keeps working meanwhile.
    try {
      client.release(err);
    } catch {
      /* already gone */
    }
    listener = null;
    setTimeout(() => {
      startListener().catch((e) =>
        console.error(`[discovery] listener reconnect failed: ${e.message}`)
      );
    }, 5000);
  });

  await client.query(`LISTEN ${CHANNEL}`);
  console.log(`[discovery] listening for on-demand runs on '${CHANNEL}'`);
}

export async function startScheduler() {
  if (!DISCOVERY_ENABLED) {
    console.log(
      '[discovery] disabled in this process (DISCOVERY_ENABLED=false) — ' +
        'expected for the API; the worker owns discovery'
    );
    return;
  }

  const probe = await ping();
  if (!probe.ok) {
    console.error(`[discovery] Docker socket unreachable at ${probe.socket}: ${probe.error}`);
    console.error(
      '[discovery] mount it read-only into the WORKER only, e.g. ' +
        '/var/run/docker.sock:/var/run/docker.sock:ro'
    );
  } else {
    console.log(`[discovery] Docker socket OK (${probe.socket})`);
  }

  await startListener().catch((err) =>
    console.error(`[discovery] could not start listener: ${err.message}`)
  );

  task = cron.schedule(SCHEDULE, () => runQuietly('scheduled'));
  console.log(`[discovery] scheduled '${SCHEDULE}'`);

  runQuietly('startup');
}

export function stopScheduler() {
  if (task) {
    task.stop();
    task = null;
  }
  if (listener) {
    try {
      listener.release();
    } catch {
      /* ignore */
    }
    listener = null;
  }
}

export { getRecentRuns };
