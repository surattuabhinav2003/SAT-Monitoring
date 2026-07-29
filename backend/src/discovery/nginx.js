import { readdir, readFile, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';

/**
 * URL discovery from the nginx reverse-proxy configuration.
 *
 * Nginx is the only component that actually knows which hostname routes to which
 * container, so it is the authoritative second source after an explicit
 * `sat.url` label. Guessing from a container name is NOT a fallback here — an
 * unmapped application is flagged instead.
 *
 * Read-only: the directory is mounted `:ro` and nothing here writes.
 *
 * Parses `server { server_name X; ... proxy_pass http://Y:port; }` and yields
 * upstream-target -> hostname. Deliberately a pragmatic parser, not a full
 * nginx grammar: it handles the ordinary reverse-proxy vhost shape and ignores
 * anything it does not understand rather than failing the pass.
 */

const CONF_DIR = process.env.NGINX_CONF_DIR || '';
const CONF_EXTENSIONS = new Set(['.conf', '']);
const MAX_DEPTH = 3;

export const NGINX_ENABLED = Boolean(CONF_DIR);

/** Collect candidate config files, following includes one directory deep. */
async function collectFiles(dir, depth = 0) {
  if (depth > MAX_DEPTH) return [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const files = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(full, depth + 1)));
    } else if (entry.isFile() || entry.isSymbolicLink()) {
      // sites-enabled entries are usually symlinks.
      if (entry.isSymbolicLink()) {
        try {
          const s = await stat(full);
          if (!s.isFile()) continue;
        } catch {
          continue;
        }
      }
      if (CONF_EXTENSIONS.has(extname(entry.name))) files.push(full);
    }
  }
  return files;
}

/** Split a config into top-level `server { ... }` blocks by brace depth. */
function serverBlocks(text) {
  const blocks = [];
  const re = /server\s*\{/g;
  let match;
  while ((match = re.exec(text)) !== null) {
    let depth = 1;
    let i = match.index + match[0].length;
    const start = i;
    while (i < text.length && depth > 0) {
      const ch = text[i];
      if (ch === '{') depth += 1;
      else if (ch === '}') depth -= 1;
      i += 1;
    }
    if (depth === 0) blocks.push(text.slice(start, i - 1));
  }
  return blocks;
}

/** Strip comments so a commented-out vhost is not treated as live routing. */
function stripComments(text) {
  return text.replace(/(^|\s)#[^\n]*/g, '$1');
}

/**
 * Build a routing table from the nginx configuration.
 *
 * @returns {Promise<{targets: Map<string,string>, hosts: string[], files: number}>}
 *   targets maps a lowercased upstream key -> hostname. Keys include the bare
 *   upstream host ("trainer-frontend") and host:port ("trainer-frontend:80"),
 *   so a container can be matched by name with or without a port.
 */
export async function loadNginxRoutes() {
  const result = { targets: new Map(), hosts: [], files: 0, upstreams: new Map() };
  if (!CONF_DIR) return result;

  const files = await collectFiles(CONF_DIR);
  result.files = files.length;

  // First pass: named upstream blocks, so `proxy_pass http://my_upstream` can be
  // resolved to the server it points at.
  for (const file of files) {
    let text;
    try {
      text = stripComments(await readFile(file, 'utf8'));
    } catch {
      continue;
    }
    const upRe = /upstream\s+([A-Za-z0-9_.-]+)\s*\{([^}]*)\}/g;
    let up;
    while ((up = upRe.exec(text)) !== null) {
      const name = up[1].toLowerCase();
      const first = /server\s+([A-Za-z0-9_.:-]+)/.exec(up[2]);
      if (first) result.upstreams.set(name, first[1].toLowerCase());
    }
  }

  // Second pass: vhosts.
  for (const file of files) {
    let text;
    try {
      text = stripComments(await readFile(file, 'utf8'));
    } catch {
      continue;
    }

    for (const block of serverBlocks(text)) {
      const nameMatch = /server_name\s+([^;]+);/.exec(block);
      if (!nameMatch) continue;

      const hostnames = nameMatch[1]
        .trim()
        .split(/\s+/)
        .map((h) => h.trim().toLowerCase())
        .filter((h) => h && h !== '_' && !h.startsWith('*'));
      if (hostnames.length === 0) continue;

      const host = hostnames[0];
      result.hosts.push(host);

      const passRe = /proxy_pass\s+https?:\/\/([^;/\s]+)/g;
      let pass;
      while ((pass = passRe.exec(block)) !== null) {
        let target = pass[1].toLowerCase();
        if (result.upstreams.has(target)) target = result.upstreams.get(target);

        const [tHost, tPort] = target.split(':');
        // Register several keys so matching can be tried from most to least
        // specific later.
        if (tPort) result.targets.set(`${tHost}:${tPort}`, host);
        result.targets.set(tHost, host);
        if (tPort) result.targets.set(`port:${tPort}`, host);
      }
    }
  }

  return result;
}

/**
 * Resolve a hostname for a container from the nginx routing table.
 *
 * Matching order, most specific first:
 *   1. container name + published port
 *   2. container name
 *   3. compose service name
 *   4. a published port that nginx proxies to on localhost/127.0.0.1
 *
 * Returns null when nginx does not route to this container — the caller then
 * flags the application as needing mapping.
 */
export function resolveHost(routes, container) {
  if (!routes || routes.targets.size === 0) return null;

  const name = (container.name || '').toLowerCase();
  const service = (container.service || '').toLowerCase();
  const ports = container.ports || [];

  for (const p of ports) {
    const hit = routes.targets.get(`${name}:${p.private}`) ||
      routes.targets.get(`${name}:${p.public}`);
    if (hit) return hit;
  }
  if (routes.targets.has(name)) return routes.targets.get(name);
  if (service && routes.targets.has(service)) return routes.targets.get(service);

  for (const p of ports) {
    const hit = routes.targets.get(`port:${p.public}`);
    if (hit) return hit;
  }
  return null;
}

export { CONF_DIR as NGINX_CONF_DIR };
