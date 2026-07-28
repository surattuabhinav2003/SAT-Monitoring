import api from './api.js';

/**
 * Application data service — backed by PostgreSQL via the REST API.
 *
 * There is no local/dummy fallback: applications are shared data, so they must
 * come from the database rather than from one browser's storage. If the API is
 * unreachable the call rejects and the page surfaces the error.
 *
 *   GET    /applications
 *   POST   /applications
 *   PUT    /applications/:id
 *   DELETE /applications/:id
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

export async function createApplication(payload) {
  const { data } = await api.post('/applications', payload);
  return normalize(data);
}

export async function updateApplication(id, payload) {
  const { data } = await api.put(`/applications/${id}`, payload);
  return normalize(data);
}

export async function deleteApplication(id) {
  await api.delete(`/applications/${id}`);
  return { success: true };
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
