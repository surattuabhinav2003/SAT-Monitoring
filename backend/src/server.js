import 'dotenv/config';
import express from 'express';
import cors from 'cors';

import { initDatabase, pool } from './db.js';
import { errorHandler, notFoundHandler } from './errors.js';
import { reportAuthConfig } from './auth.js';
import applicationsRouter from './routes/applications.js';
import adminsRouter from './routes/admins.js';
import usersRouter from './routes/users.js';
import notificationsRouter from './routes/notifications.js';
import { startScheduler, stopScheduler, DISCOVERY_ENABLED } from './discovery/scheduler.js';
import { getRecentRuns } from './discovery/sync.js';

const PORT = Number(process.env.PORT || 4000);

// Comma-separated list of origins allowed to call the API.
const CORS_ORIGINS = (process.env.CORS_ORIGINS || 'http://localhost:5180')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

const app = express();

app.use(
  cors({
    origin: CORS_ORIGINS,
    // The SPA sends the token in the Authorization header, so it must be an
    // allowed request header on preflight.
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);
app.use(express.json({ limit: '100kb' }));

// Health is intentionally public: load balancers and `docker compose` probes
// need it, and it exposes no data beyond liveness.
/**
 * Health. Public so load balancers can probe it; exposes no data beyond liveness.
 *
 * Discovery health is reported from the RUN HISTORY, not by touching Docker —
 * this process has no Docker access, which is the point.
 */
app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');

    let discovery = 'unknown';
    try {
      const [latest] = await getRecentRuns(1);
      if (!latest) {
        discovery = 'no runs yet';
      } else {
        const ageMin = Math.round((Date.now() - new Date(latest.startedAt).getTime()) / 60000);
        // Stale after 15 minutes: three missed 5-minute passes means the worker
        // is not running or cannot reach Docker.
        discovery = latest.errors ? 'failing' : ageMin > 15 ? 'stale' : 'ok';
      }
    } catch {
      discovery = 'unknown';
    }

    res.json({ status: 'ok', database: 'up', discovery, dockerAccess: false });
  } catch {
    res.status(503).json({ status: 'degraded', database: 'down' });
  }
});

app.use('/api/applications', applicationsRouter);
app.use('/api/admins', adminsRouter);
app.use('/api/users', usersRouter);
app.use('/api/notifications', notificationsRouter);

app.use(notFoundHandler);
app.use(errorHandler);

async function start() {
  try {
    await initDatabase();
  } catch (err) {
    console.error('[api] could not initialise the database:', err.message);
    process.exit(1);
  }

  const server = app.listen(PORT, async () => {
    console.log(`[api] listening on http://localhost:${PORT}`);
    console.log(`[api] CORS allows: ${CORS_ORIGINS.join(', ')}`);
    reportAuthConfig();

    if (DISCOVERY_ENABLED) {
      // Supported for a single-container deployment, but NOT recommended: it
      // requires giving the API the Docker socket, which is root-equivalent on
      // the host. Prefer the standalone worker.
      console.warn(
        '[api] DISCOVERY_ENABLED=true — this process needs Docker socket access. ' +
          'Prefer the standalone worker and leave the API without Docker privileges.'
      );
      await startScheduler();
    } else {
      console.log('[api] no Docker access (discovery runs in the worker)');
    }
  });

  // Let Docker stop the container without severing in-flight requests.
  for (const signal of ['SIGTERM', 'SIGINT']) {
    process.on(signal, () => {
      console.log(`[api] ${signal} received — shutting down`);
      stopScheduler();
      server.close(() => pool.end().then(() => process.exit(0)));
    });
  }
}

start();
