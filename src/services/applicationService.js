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

export async function getDiscoveryState() {
  const { data } = await api.get('/applications/discovery');
  return data;
}

/** Trigger a discovery pass immediately (admin). */
export async function runDiscovery() {
  const { data } = await api.post('/applications/discovery/run');
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
