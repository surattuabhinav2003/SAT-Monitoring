import { useState, useEffect, useCallback } from 'react';
import {
  getApplications,
  createApplication,
  updateApplication,
  deleteApplication,
} from '../services/applicationService.js';

/**
 * Encapsulates all application CRUD state so pages/components stay lean.
 * Returns data, loading/error flags, and memoized action creators.
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

  const addApplication = useCallback(async (payload) => {
    const created = await createApplication(payload);
    setApplications((prev) => [created, ...prev]);
    return created;
  }, []);

  const editApplication = useCallback(async (id, payload) => {
    const updated = await updateApplication(id, payload);
    setApplications((prev) => prev.map((app) => (app.id === id ? updated : app)));
    return updated;
  }, []);

  const removeApplication = useCallback(async (id) => {
    await deleteApplication(id);
    setApplications((prev) => prev.filter((app) => app.id !== id));
  }, []);

  return {
    applications,
    loading,
    error,
    reload: load,
    addApplication,
    editApplication,
    removeApplication,
  };
}
