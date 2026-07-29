import Docker from 'dockerode';

/**
 * Thin wrapper over the LOCAL Docker Engine API.
 *
 * Local socket only — no SSH, no remote host, no credentials. Mounted read-only
 * into the discovery worker and NOWHERE else (the API has no Docker access).
 */

const DEFAULT_SOCKET =
  process.platform === 'win32' ? '//./pipe/docker_engine' : '/var/run/docker.sock';

const SOCKET_PATH = process.env.DOCKER_SOCKET || DEFAULT_SOCKET;

/** Cap concurrent inspects so a large host cannot swamp the daemon. */
const INSPECT_CONCURRENCY = Number(process.env.DISCOVERY_INSPECT_CONCURRENCY || 8);

let docker = null;
function client() {
  if (!docker) docker = new Docker({ socketPath: SOCKET_PATH });
  return docker;
}

/** Container names come back from the API with a leading slash. */
function cleanName(names) {
  const raw = Array.isArray(names) && names.length > 0 ? names[0] : '';
  return raw.replace(/^\//, '');
}

/**
 * Docker's own health state, when the image declares a HEALTHCHECK.
 *
 * `listContainers` only exposes it inside a human string ("Up 2 hours
 * (healthy)"), so the authoritative value has to come from inspect:
 *   State.Health.Status -> starting | healthy | unhealthy
 * Containers with no HEALTHCHECK have no Health object at all, which is
 * reported as `none` rather than guessed.
 */
async function inspectHealth(id) {
  try {
    const info = await client().getContainer(id).inspect();
    const state = info?.State || {};
    return {
      health: state.Health?.Status || 'none',
      // Fall back to the list view's State if inspect disagrees.
      state: state.Status || null,
      startedAt: state.StartedAt || null,
      exitCode: typeof state.ExitCode === 'number' ? state.ExitCode : null,
      restartCount: typeof info?.RestartCount === 'number' ? info.RestartCount : null,
    };
  } catch {
    // A container can vanish between list and inspect; treat as unknown rather
    // than failing the whole pass.
    return { health: 'unknown', state: null, startedAt: null, exitCode: null, restartCount: null };
  }
}

/** Run `worker` over `items` with a bounded number in flight. */
async function mapLimit(items, limit, worker) {
  const out = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await worker(items[i], i);
    }
  });
  await Promise.all(runners);
  return out;
}

/**
 * List every container, running or not, enriched with its health state.
 *
 * `all: true` matters: a stopped container must still be reported so the sync
 * can mark its application Inactive rather than treating it as vanished.
 */
export async function listContainers() {
  const raw = await client().listContainers({ all: true });

  const base = raw.map((c) => ({
    id: c.Id,
    name: cleanName(c.Names),
    image: c.Image,
    // Compose groups a multi-container tool under one project name.
    project: (c.Labels || {})['com.docker.compose.project'] || null,
    service: (c.Labels || {})['com.docker.compose.service'] || null,
    state: c.State, // created|restarting|running|removing|paused|exited|dead
    statusText: c.Status,
    labels: c.Labels || {},
    createdAt: c.Created ? new Date(c.Created * 1000) : null,
    ports: (c.Ports || [])
      .filter((p) => p.PublicPort)
      .map((p) => ({ public: p.PublicPort, private: p.PrivatePort })),
    networks: Object.keys(c.NetworkSettings?.Networks || {}),
  }));

  const health = await mapLimit(base, INSPECT_CONCURRENCY, (c) => inspectHealth(c.id));

  return base.map((c, i) => ({
    ...c,
    health: health[i].health,
    exitCode: health[i].exitCode,
    restartCount: health[i].restartCount,
  }));
}

/** Whether the Docker socket is reachable. Used for health reporting. */
export async function ping() {
  try {
    await client().ping();
    return { ok: true, socket: SOCKET_PATH };
  } catch (err) {
    return { ok: false, socket: SOCKET_PATH, error: err.message };
  }
}

export { SOCKET_PATH };
