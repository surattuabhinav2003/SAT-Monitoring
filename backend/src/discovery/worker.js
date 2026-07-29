import 'dotenv/config';
import { initDatabase, pool } from '../db.js';
import { startScheduler, stopScheduler } from './scheduler.js';
import { SOCKET_PATH } from './docker.js';

/**
 * Standalone discovery worker.
 *
 * Same code as the in-process scheduler, run as its own container so the Docker
 * socket is mounted into ONLY this process rather than into the API. That is
 * the safer deployment: socket access is root-equivalent on the host, so it
 * should be granted to as little as possible.
 *
 * Run the API with DISCOVERY_ENABLED=false when using this worker, otherwise
 * both would sync.
 *
 *   node src/discovery/worker.js
 */
async function main() {
  console.log('[worker] SAT Monitoring discovery worker');
  console.log(`[worker] docker socket: ${SOCKET_PATH}`);

  // Applies the schema too, so the worker can start before or after the API.
  await initDatabase();
  await startScheduler();

  for (const signal of ['SIGTERM', 'SIGINT']) {
    process.on(signal, async () => {
      console.log(`[worker] ${signal} received — shutting down`);
      stopScheduler();
      await pool.end();
      process.exit(0);
    });
  }
}

main().catch((err) => {
  console.error('[worker] fatal:', err);
  process.exit(1);
});
