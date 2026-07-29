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
import { ping as dockerPing } from './discovery/docker.js';

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
app.get('/api/health', async (_req, res) => {
  const docker = DISCOVERY_ENABLED ? await dockerPing() : { ok: null };
  try {
    await pool.query('SELECT 1');
    res.json({
      status: 'ok',
      database: 'up',
      // Reported but not fatal: the API still serves the existing inventory
      // when Docker is unreachable, it just cannot refresh it.
      docker: docker.ok === null ? 'disabled' : docker.ok ? 'up' : 'unreachable',
    });
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
    // Set DISCOVERY_ENABLED=false here when running the standalone worker
    // instead, so the two do not both sync.
    await startScheduler();
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
