import cron from 'node-cron';
import { runSync } from './sync.js';
import { ping } from './docker.js';

/**
 * Periodic Docker discovery.
 *
 * Default cadence is every 5 minutes. A pass is skipped while the previous one
 * is still running, so a slow Docker daemon cannot stack up overlapping syncs.
 */

const SCHEDULE = process.env.DISCOVERY_CRON || '*/5 * * * *';
export const DISCOVERY_ENABLED =
  String(process.env.DISCOVERY_ENABLED ?? 'true').toLowerCase() === 'true';

let running = false;
let task = null;
let last = null;

export function getDiscoveryState() {
  return { enabled: DISCOVERY_ENABLED, schedule: SCHEDULE, running, last };
}

/**
 * Run one pass, guarding against overlap.
 *
 * Returns stats on success, null when SKIPPED because a pass is already in
 * flight, and THROWS on failure — the caller needs to tell those apart, so that
 * "Docker is unreachable" is not reported as "already running".
 */
export async function runOnce(trigger = 'manual') {
  if (running) {
    console.log(`[discovery] ${trigger} pass skipped — previous pass still running`);
    return null;
  }

  running = true;
  const startedAt = new Date();
  try {
    const stats = await runSync();
    last = { at: startedAt.toISOString(), trigger, ok: true, ...stats };
    console.log(
      `[discovery] ${trigger}: ${stats.seen} container(s) — ` +
        `${stats.created} new, ${stats.activated} restored, ` +
        `${stats.deactivated} stopped, ${stats.unchanged} unchanged`
    );
    return stats;
  } catch (err) {
    last = { at: startedAt.toISOString(), trigger, ok: false, error: err.message };
    console.error(`[discovery] ${trigger} pass failed: ${err.message}`);
    throw err;
  } finally {
    running = false;
  }
}

/** Scheduled/startup wrapper: a failure must never crash the process. */
async function runQuietly(trigger) {
  try {
    await runOnce(trigger);
  } catch {
    // Already logged by runOnce; the next tick will retry.
  }
}

export async function startScheduler() {
  if (!DISCOVERY_ENABLED) {
    console.log('[discovery] disabled (DISCOVERY_ENABLED=false)');
    return;
  }

  const probe = await ping();
  if (!probe.ok) {
    // Not fatal: the API must still serve the existing inventory. Discovery
    // retries on its normal schedule in case the socket appears later.
    console.error(
      `[discovery] Docker socket unreachable at ${probe.socket}: ${probe.error}`
    );
    console.error(
      '[discovery] mount the socket read-only, e.g. ' +
        '/var/run/docker.sock:/var/run/docker.sock:ro'
    );
  } else {
    console.log(`[discovery] Docker socket OK (${probe.socket})`);
  }

  task = cron.schedule(SCHEDULE, () => runQuietly('scheduled'));
  console.log(`[discovery] scheduled '${SCHEDULE}'`);

  // Seed immediately so a fresh deployment is populated without waiting.
  runQuietly('startup');
}

export function stopScheduler() {
  if (task) {
    task.stop();
    task = null;
  }
}
