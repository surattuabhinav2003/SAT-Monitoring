import api from './api.js';

/**
 * Application data service — backed by PostgreSQL via the REST API.
 *
 * Applications are DISCOVERED from Docker, not created by hand, so there is no
 * create and no delete here. Admins update only the business metadata they own
 * (team, developedBy, gstack, decommissioned, notes); discovery owns identity
 * and liveness.
 *
 *   GET  /applications
 *   PUT  /applications/:id          — admin-owned fields only
 *   GET  /applications/:id/events   — audit trail
 *   GET  /applications/discovery    — scheduler state
 *   POST /applications/discovery/run
 */

/** Coerce a record into the canonical shape (booleans are always booleans). */
function normalize(app) {
  return {
    ...app,
    decommissioned: Boolean(app.decommissioned),
    gstackImplemented: Boolean(app.gstackImplemented),
  };
}

export async function getApplications() {
  const { data } = await api.get('/applications');
  return data.map(normalize);
}

/**
 * Update the admin-owned metadata for an application.
 * Server-owned fields are ignored by the API even if sent.
 */
export async function updateApplication(id, payload) {
  const { data } = await api.put(`/applications/${id}`, {
    team: payload.team,
    developedBy: payload.developedBy,
    gstackImplemented: payload.gstackImplemented,
    decommissioned: payload.decommissioned,
    notes: payload.notes,
  });
  return normalize(data);
}

export async function getApplicationEvents(id) {
  const { data } = await api.get(`/applications/${id}/events`);
  return data;
}

/** Approve a newly discovered application out of pending_review. */
export async function approveApplication(id) {
  const { data } = await api.post(`/applications/${id}/approve`);
  return normalize(data);
}

/**
 * Supply the hostname for an application discovery could not map.
 * Separate from metadata because `url` is normally server-owned.
 */
export async function setApplicationUrl(id, url) {
  const { data } = await api.put(`/applications/${id}/url`, { url });
  return normalize(data);
}

/**
 * The company's teams, from the API.
 *
 * Fetched rather than hardcoded so the picker always matches what the server
 * will accept — a local copy would silently drift when the list changes.
 */
export async function getTeams() {
  const { data } = await api.get('/applications/teams');
  return data.teams || [];
}

export async function getDiscoveryState() {
  const { data } = await api.get('/applications/discovery');
  return data;
}

/**
 * Run a discovery pass and return its result (designated operators only).
 *
 * The scan executes in the worker, but the API waits for it and returns the real
 * counts, so the caller gets an outcome rather than an acknowledgement.
 *
 * The longer timeout matters: the shared 15s default would abort the request
 * before the server's 20s wait for the worker could finish.
 */
export async function runDiscovery() {
  const { data } = await api.post('/applications/discovery/run', null, {
    timeout: 40_000,
  });
  return data;
}

/**
 * Aggregate summary counts for the dashboard cards.
 * A real backend may expose GET /applications/summary; here we derive it.
 */
export async function getSummary() {
  const apps = await getApplications();
  return {
    live: apps.filter((a) => a.status === 'Active' && !a.decommissioned).length,
    decommissioned: apps.filter((a) => a.decommissioned).length,
    inactive: apps.filter((a) => a.status === 'Inactive' && !a.decommissioned).length,
    gstack: apps.filter((a) => a.gstackImplemented).length,
    noGstack: apps.filter((a) => !a.gstackImplemented).length,
    total: apps.length,
  };
}
