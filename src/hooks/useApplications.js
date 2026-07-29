import { useState, useEffect, useCallback } from 'react';
import {
  getApplications,
  updateApplication,
} from '../services/applicationService.js';

/**
 * Application state for pages/components.
 *
 * There is no add or remove: applications are discovered from Docker and are
 * never deleted. Admins edit business metadata only.
 */
export function useApplications() {
  const [applications, setApplications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getApplications();
      setApplications(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const editApplication = useCallback(async (id, payload) => {
    const updated = await updateApplication(id, payload);
    setApplications((prev) => prev.map((app) => (app.id === id ? updated : app)));
    return updated;
  }, []);

  /**
   * Swap in a record the caller already updated (approve, set-URL), so the row
   * refreshes without refetching the whole list.
   */
  const replaceApplication = useCallback((updated) => {
    setApplications((prev) => prev.map((app) => (app.id === updated.id ? updated : app)));
  }, []);

  return {
    applications,
    loading,
    error,
    reload: load,
    editApplication,
    replaceApplication,
  };
}
