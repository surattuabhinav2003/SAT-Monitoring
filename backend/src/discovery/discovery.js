import { listContainers } from './docker.js';

/**
 * Turns raw Docker containers into candidate application records.
 *
 * Pure mapping and filtering — no database work, so it can be tested against a
 * fixed container list.
 *
 * Two rules do most of the work:
 *  - Infrastructure is excluded by IMAGE, not name. A Postgres container called
 *    "trainer-db" has nothing in its name to match on, but its image is
 *    unmistakable.
 *  - Containers are grouped by COMPOSE PROJECT. A tool built from frontend +
 *    backend + db is one application, not three.
 */

/** Base domain used when a container carries no explicit URL label. */
const BASE_DOMAIN = process.env.DISCOVERY_BASE_DOMAIN || 'cftools.live';
const URL_SCHEME = process.env.DISCOVERY_URL_SCHEME || 'https';

/** Label names, configurable so a team can adopt its own convention. */
const LABEL_URL = process.env.DISCOVERY_LABEL_URL || 'sat.url';
const LABEL_NAME = process.env.DISCOVERY_LABEL_NAME || 'sat.name';
const LABEL_IGNORE = process.env.DISCOVERY_LABEL_IGNORE || 'sat.ignore';

/**
 * Images that are infrastructure rather than a user-facing tool. Matched as a
 * substring of the image reference, so "postgres:16-alpine" and
 * "bitnami/postgresql" both hit.
 */
const INFRA_IMAGES = [
  'postgres',
  'mysql',
  'mariadb',
  'mongo',
  'redis',
  'memcached',
  'rabbitmq',
  'kafka',
  'zookeeper',
  'elasticsearch',
  'nginx',
  'traefik',
  'haproxy',
  'certbot',
  'watchtower',
  'portainer',
  'busybox',
  'alpine',
];

/**
 * The portal's own containers must never appear in its own inventory.
 *
 * Checked against the container name, its compose project AND its image,
 * because `docker compose build` bakes `com.docker.compose.project` into the
 * image — so a container started from that image by any means reports the
 * project and would otherwise be inventoried as "Sat Monitoring".
 */
const SELF_NAMES = ['sat-api', 'sat-db', 'sat-worker'];
const SELF_PROJECTS = ['sat-monitoring'];
const SELF_IMAGES = ['sat-monitoring-api'];

const EXTRA_EXCLUDES = (process.env.DISCOVERY_EXCLUDE || '')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

/** Docker states that mean "up right now". */
const RUNNING_STATES = new Set(['running']);

/** Compose services that are supporting parts, never the tool's front door. */
const SUPPORT_SERVICES = ['db', 'database', 'postgres', 'redis', 'cache', 'mongo', 'worker'];

/**
 * "ai-communication" -> "Ai Communication"; "delta_pre_checks" -> "Delta Pre Checks"
 */
export function toDisplayName(raw) {
  return String(raw || '')
    .replace(/[-_.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}

/**
 * Derive a hostname by stripping separators, mirroring the convention on the
 * server: "ai-comm-trainer" -> "aicommtrainer.cftools.live".
 */
export function toUrl(key, labels = {}) {
  const labelled = labels[LABEL_URL];
  if (labelled) {
    const value = String(labelled).trim();
    return /^https?:\/\//i.test(value) ? value : `${URL_SCHEME}://${value}`;
  }
  const host = String(key || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return `${URL_SCHEME}://${host}.${BASE_DOMAIN}`;
}

function isInfraImage(image) {
  const ref = String(image || '').toLowerCase();
  return INFRA_IMAGES.some((i) => ref.includes(i));
}

/**
 * Whether a container should be inventoried.
 *
 * Precedence matters, most specific first:
 *   1. sat.ignore label            — explicit opt-out
 *   2. DISCOVERY_EXCLUDE           — operator's explicit exclusion
 *   3. the portal's own containers  — never inventory itself
 *   4. sat.url / sat.name label    — explicit opt-in, beats the image heuristic
 *   5. infrastructure image        — heuristic fallback
 *
 * Steps 2 and 3 sit ABOVE the label opt-in on purpose: an operator excluding a
 * name is a more deliberate instruction than a label on the container, so a
 * labelled container in an excluded project stays out.
 */
export function isCandidate(container) {
  const labels = container.labels || {};
  const name = (container.name || '').toLowerCase();
  const project = (container.project || '').toLowerCase();
  const image = (container.image || '').toLowerCase();

  if (String(labels[LABEL_IGNORE] || '').toLowerCase() === 'true') return false;
  if (!name) return false;

  if (
    EXTRA_EXCLUDES.some(
      (ex) => name === ex || name.includes(ex) || (project && project.includes(ex))
    )
  ) {
    return false;
  }

  // Self-exclusion across all three identifiers — see SELF_NAMES.
  if (
    SELF_NAMES.some((s) => name === s || name.startsWith(`${s}-`)) ||
    SELF_PROJECTS.includes(project) ||
    SELF_IMAGES.some((s) => image.includes(s))
  ) {
    return false;
  }

  if (labels[LABEL_URL] || labels[LABEL_NAME]) return true;

  if (isInfraImage(container.image)) return false;

  return true;
}

/**
 * Pick the container that best represents a compose project: prefer one with a
 * published port and a non-supporting service name, so the frontend wins over
 * a worker or database.
 */
function pickRepresentative(containers) {
  const scored = containers.map((c) => {
    let score = 0;
    if ((c.ports || []).length > 0) score += 4;
    const service = (c.service || c.name || '').toLowerCase();
    if (SUPPORT_SERVICES.some((s) => service === s || service.endsWith(`-${s}`))) score -= 3;
    if (/front|web|ui|app/.test(service)) score += 3;
    if (c.labels?.[LABEL_URL]) score += 10;
    if (RUNNING_STATES.has(c.state)) score += 1;
    return { c, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0].c;
}

/**
 * Collect the current inventory from Docker.
 *
 * Containers in the same compose project collapse into one application; the
 * project is Active if ANY of its containers is running, because a tool with a
 * live frontend is up even if a sidecar has exited.
 */
export async function discover() {
  const containers = (await listContainers()).filter(isCandidate);

  // Group by compose project, so a tool built from several containers is one
  // application.
  //
  // An explicit sat.url / sat.name label opts a container OUT of grouping: the
  // label is a deliberate statement that this container is its own tool, which
  // is what allows several distinct tools to live in one compose project.
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

    const name = labels[LABEL_NAME]
      ? String(labels[LABEL_NAME]).trim()
      : toDisplayName(identity);

    apps.push({
      containerKey: key,
      name,
      url: toUrl(identity, labels),
      // Any member running means the tool is up.
      status: members.some((m) => RUNNING_STATES.has(m.state)) ? 'Active' : 'Inactive',
      containers: members.map((m) => m.name),
      createdAt: rep.createdAt,
    });
  }

  return apps;
}

export { BASE_DOMAIN, LABEL_URL, LABEL_NAME, LABEL_IGNORE, INFRA_IMAGES };
