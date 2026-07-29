import { listContainers } from './docker.js';
import { loadNginxRoutes, resolveHost, NGINX_ENABLED } from './nginx.js';

/**
 * Turns raw Docker containers into candidate application records.
 *
 * Pure mapping and filtering apart from reading the nginx config, so the
 * decision logic can be tested against a fixed container list.
 *
 * URL RESOLUTION ORDER — no guessing:
 *   1. `sat.url` label            (explicit, authoritative)
 *   2. nginx server_name/proxy_pass  (the component that actually routes)
 *   3. none -> url stays NULL and the application is flagged "Needs Mapping"
 *
 * Deriving a hostname from the container name was removed deliberately: it
 * produced confident-looking URLs that were wrong, which is worse than an
 * obvious gap an admin can fill in.
 */

const URL_SCHEME = process.env.DISCOVERY_URL_SCHEME || 'https';

/** Label names, configurable so a team can adopt its own convention. */
const LABEL_URL = process.env.DISCOVERY_LABEL_URL || 'sat.url';
const LABEL_NAME = process.env.DISCOVERY_LABEL_NAME || 'sat.name';
const LABEL_IGNORE = process.env.DISCOVERY_LABEL_IGNORE || 'sat.ignore';

/**
 * Infrastructure that is never a user-facing tool.
 *
 * Matched against the container NAME (whole or hyphen-delimited segment), the
 * compose SERVICE, and the IMAGE reference — because a Postgres container named
 * "trainer-db" has nothing in its name to match on, while a container named
 * "worker" has nothing in its image to match on. Both directions are needed.
 *
 * Extend with DISCOVERY_EXCLUDE (comma-separated) rather than editing this list.
 */
const DEFAULT_EXCLUDES = [
  'postgres',
  'postgresql',
  'mongo',
  'mongodb',
  'mongo-express',
  'redis',
  'memcached',
  'mysql',
  'mariadb',
  'rabbitmq',
  'kafka',
  'zookeeper',
  'elasticsearch',
  'nginx',
  'traefik',
  'haproxy',
  'caddy',
  'certbot',
  'watchtower',
  'portainer',
  'worker',
  'sat-api',
  'sat-db',
];

const EXTRA_EXCLUDES = (process.env.DISCOVERY_EXCLUDE || '')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

/** Set DISCOVERY_EXCLUDE_DEFAULTS=false to rely solely on DISCOVERY_EXCLUDE. */
const USE_DEFAULT_EXCLUDES =
  String(process.env.DISCOVERY_EXCLUDE_DEFAULTS ?? 'true').toLowerCase() === 'true';

/**
 * The two exclusion sets are checked at DIFFERENT precedence, which matters:
 *
 *  - EXTRA_EXCLUDES is what an operator configured, so it beats everything,
 *    including a `sat.url` label on the container.
 *  - DEFAULT_EXCLUDES is a built-in heuristic ("images called postgres are
 *    probably databases"). A label is a human being explicit about this exact
 *    container, so it must win over the guess — otherwise a tool legitimately
 *    served by an nginx image could never be inventoried.
 */
const EXCLUDES = [...(USE_DEFAULT_EXCLUDES ? DEFAULT_EXCLUDES : []), ...EXTRA_EXCLUDES];

/**
 * The portal's own containers, checked by name, compose project AND image:
 * `docker compose build` bakes com.docker.compose.project into the image, so a
 * container started from that image by any means reports the project.
 */
const SELF_NAMES = ['sat-api', 'sat-db', 'sat-worker'];
const SELF_PROJECTS = ['sat-monitoring'];
const SELF_IMAGES = ['sat-monitoring-api'];

/** Compose services that are supporting parts, never a tool's front door. */
const SUPPORT_SERVICES = ['db', 'database', 'postgres', 'redis', 'cache', 'mongo', 'worker'];

/**
 * Docker health -> portal status.
 *   healthy   -> Active
 *   unhealthy -> Warning
 *   starting  -> Warning   (not yet serving; not an outage either)
 *   exited / anything not running -> Inactive
 *
 * A container with no HEALTHCHECK reports `none`, in which case the container
 * state alone decides: running -> Active.
 */
export function mapStatus(container) {
  const state = (container.state || '').toLowerCase();
  const health = (container.health || 'none').toLowerCase();

  if (state !== 'running') return 'Inactive';
  if (health === 'unhealthy') return 'Warning';
  if (health === 'starting') return 'Warning';
  return 'Active'; // healthy, none, or unknown while running
}

/** "ai-communication" -> "Ai Communication" */
export function toDisplayName(raw) {
  return String(raw || '')
    .replace(/[-_.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}

function matchesExclude(value, excludes) {
  if (!value) return false;
  const v = value.toLowerCase();
  return excludes.some(
    (ex) =>
      v === ex ||
      v.startsWith(`${ex}-`) ||
      v.endsWith(`-${ex}`) ||
      v.includes(`-${ex}-`) ||
      v.includes(`/${ex}`) || // image paths like bitnami/postgresql
      v.startsWith(`${ex}:`) // image tags like postgres:16
  );
}

/**
 * Whether a container should be inventoried.
 *
 * Precedence, most authoritative first:
 *   1. sat.ignore label        — explicit opt-out
 *   2. DISCOVERY_EXCLUDE       — operator's configured exclusion
 *   3. the portal itself       — never inventory itself
 *   4. sat.url / sat.name      — explicit opt-in
 *   5. built-in exclude list   — heuristic on name/service/image
 *   6. nothing matched         — inventory it
 *
 * Steps 2 and 5 are both "exclusions" but sit on opposite sides of the label:
 * an operator's configured exclusion overrides a label, while the built-in
 * heuristic does not. Without that split, a tool served by an `nginx` image
 * could never be inventoried even when explicitly labelled.
 */
export function isCandidate(container) {
  const labels = container.labels || {};
  const name = (container.name || '').toLowerCase();
  const project = (container.project || '').toLowerCase();
  const service = (container.service || '').toLowerCase();
  const image = (container.image || '').toLowerCase();

  if (String(labels[LABEL_IGNORE] || '').toLowerCase() === 'true') return false;
  if (!name) return false;

  // 2. Operator's explicit exclusions — highest authority after opt-out.
  if (
    matchesExclude(name, EXTRA_EXCLUDES) ||
    matchesExclude(service, EXTRA_EXCLUDES) ||
    matchesExclude(image, EXTRA_EXCLUDES) ||
    EXTRA_EXCLUDES.some((ex) => project && project === ex)
  ) {
    return false;
  }

  // 3. The portal's own containers.
  if (
    SELF_NAMES.some((s) => name === s || name.startsWith(`${s}-`)) ||
    SELF_PROJECTS.includes(project) ||
    SELF_IMAGES.some((s) => image.includes(s))
  ) {
    return false;
  }

  // 4. Explicit opt-in beats the heuristic below.
  if (labels[LABEL_URL] || labels[LABEL_NAME]) return true;

  // 5. Built-in infrastructure heuristic.
  if (!USE_DEFAULT_EXCLUDES) return true;
  if (
    matchesExclude(name, DEFAULT_EXCLUDES) ||
    matchesExclude(service, DEFAULT_EXCLUDES) ||
    matchesExclude(image, DEFAULT_EXCLUDES)
  ) {
    return false;
  }

  return true;
}

/** Normalise a hostname or URL into a full URL. */
function toFullUrl(hostOrUrl) {
  const value = String(hostOrUrl || '').trim();
  if (!value) return null;
  return /^https?:\/\//i.test(value) ? value : `${URL_SCHEME}://${value}`;
}

/**
 * Pick the container that best represents a compose project: prefer one with a
 * published port and a non-supporting service name.
 */
function pickRepresentative(containers) {
  const scored = containers.map((c) => {
    let score = 0;
    if ((c.ports || []).length > 0) score += 4;
    const service = (c.service || c.name || '').toLowerCase();
    if (SUPPORT_SERVICES.some((s) => service === s || service.endsWith(`-${s}`))) score -= 3;
    if (/front|web|ui|app|proxy/.test(service)) score += 3;
    if (c.labels?.[LABEL_URL]) score += 10;
    if ((c.state || '') === 'running') score += 1;
    return { c, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0].c;
}

/**
 * Collect the current inventory from Docker.
 *
 * Containers in the same compose project collapse into one application unless a
 * `sat.url`/`sat.name` label marks one as its own tool.
 *
 * @returns {Promise<{apps: Array, scanned: number, nginx: object}>}
 */
export async function discover() {
  const all = await listContainers();
  const containers = all.filter(isCandidate);

  // Read nginx once per pass, not once per container.
  const routes = NGINX_ENABLED ? await loadNginxRoutes() : null;

  const groups = new Map();
  for (const c of containers) {
    const labels = c.labels || {};
    const standalone = Boolean(labels[LABEL_URL] || labels[LABEL_NAME]);
    const key = !standalone && c.project ? `project:${c.project}` : `container:${c.name}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(c);
  }

  const apps = [];
  for (const [key, members] of groups) {
    const rep = pickRepresentative(members);
    const labels = rep.labels || {};
    const isProject = key.startsWith('project:');
    const identity = isProject ? rep.project : rep.name;

    // --- URL: label, then nginx, then nothing ---
    let url = null;
    let urlSource = null;

    if (labels[LABEL_URL]) {
      url = toFullUrl(labels[LABEL_URL]);
      urlSource = 'label';
    } else if (routes) {
      // Try every member: nginx may route to the backend container even when the
      // frontend was chosen as the representative.
      for (const member of members) {
        const host = resolveHost(routes, member);
        if (host) {
          url = toFullUrl(host);
          urlSource = 'nginx';
          break;
        }
      }
    }

    // Status: worst state across the group is not used — a tool is up if its
    // representative front door is up, but an unhealthy member downgrades it.
    const memberStatuses = members.map(mapStatus);
    let status = 'Inactive';
    if (memberStatuses.includes('Active')) status = 'Active';
    if (memberStatuses.includes('Warning')) status = 'Warning';
    if (memberStatuses.every((s) => s === 'Inactive')) status = 'Inactive';

    apps.push({
      containerKey: key,
      name: labels[LABEL_NAME] ? String(labels[LABEL_NAME]).trim() : toDisplayName(identity),
      url,
      urlSource,
      status,
      dockerState: rep.state || null,
      healthStatus: rep.health || 'none',
      containers: members.map((m) => m.name),
      createdAt: rep.createdAt,
    });
  }

  return {
    apps,
    scanned: all.length,
    candidates: containers.length,
    nginx: routes
      ? { enabled: true, files: routes.files, hosts: routes.hosts.length }
      : { enabled: false },
  };
}

export { LABEL_URL, LABEL_NAME, LABEL_IGNORE, EXCLUDES, DEFAULT_EXCLUDES };
