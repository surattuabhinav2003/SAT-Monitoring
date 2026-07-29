import Docker from 'dockerode';

/**
 * Thin wrapper over the local Docker Engine API.
 *
 * Talks to the LOCAL socket only — no SSH, no remote host, no credentials.
 * On Linux that is /var/run/docker.sock (mount it read-only); on Windows with
 * Docker Desktop it is the named pipe.
 */

const DEFAULT_SOCKET =
  process.platform === 'win32' ? '//./pipe/docker_engine' : '/var/run/docker.sock';

const SOCKET_PATH = process.env.DOCKER_SOCKET || DEFAULT_SOCKET;

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
 * List every container, running or not.
 *
 * `all: true` matters: a stopped container must still be reported so the sync
 * can mark its application Inactive rather than treating it as vanished.
 */
export async function listContainers() {
  const raw = await client().listContainers({ all: true });

  return raw.map((c) => ({
    id: c.Id,
    name: cleanName(c.Names),
    image: c.Image,
    // Compose groups a multi-container tool under one project name, which is
    // what makes "frontend + backend + db" read as a single application.
    project: (c.Labels || {})['com.docker.compose.project'] || null,
    service: (c.Labels || {})['com.docker.compose.service'] || null,
    // Docker's State is one of: created, restarting, running, removing,
    // paused, exited, dead.
    state: c.State,
    status: c.Status,
    labels: c.Labels || {},
    createdAt: c.Created ? new Date(c.Created * 1000) : null,
    ports: (c.Ports || [])
      .filter((p) => p.PublicPort)
      .map((p) => ({ public: p.PublicPort, private: p.PrivatePort })),
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
