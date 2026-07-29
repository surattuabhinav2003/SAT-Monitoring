import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import ApplicationTable from '../components/ApplicationTable.jsx';
import ApplicationFormModal from '../components/ApplicationFormModal.jsx';
import LoadingSpinner from '../components/LoadingSpinner.jsx';
import { useApplications } from '../hooks/useApplications.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { runDiscovery, getDiscoveryState } from '../services/applicationService.js';
import './Applications.css';

/**
 * Applications page.
 *
 * The inventory is discovered from Docker — there is no create and no delete.
 * Admins edit business metadata, and can trigger a discovery pass on demand
 * rather than waiting for the 5-minute schedule.
 */
export default function Applications() {
  const { isAdmin } = useAuth();
  const toast = useToast();
  const { applications, loading, error, reload, editApplication } = useApplications();

  const [searchParams, setSearchParams] = useSearchParams();
  const [editing, setEditing] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [discovery, setDiscovery] = useState(null);

  // A dashboard card can deep-link here with ?filter=review
  const initialFilter = searchParams.get('filter') || 'all';

  useEffect(() => {
    getDiscoveryState()
      .then(setDiscovery)
      .catch(() => setDiscovery(null));
  }, []);

  async function handleSave(payload) {
    try {
      await editApplication(editing.id, payload);
      toast.success('Application details updated.');
      setEditing(null);
    } catch (err) {
      toast.error(err.message || 'Could not save the application.');
    }
  }

  async function handleSync() {
    setSyncing(true);
    try {
      const stats = await runDiscovery();
      toast.success(
        `Discovery complete — ${stats.created} new, ${stats.activated} restored, ${stats.deactivated} stopped.`
      );
      await reload();
      setDiscovery(await getDiscoveryState());
    } catch (err) {
      toast.error(err.message || 'Discovery failed.');
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="applications-page">
      <div className="applications-header">
        <div className="page-heading">
          <h1>Applications</h1>
          <p>
            Discovered automatically from Docker. Admins maintain the business
            details — team, owner, gstack and decommission status.
          </p>
        </div>

        {isAdmin && (
          <button className="btn btn--ghost" onClick={handleSync} disabled={syncing}>
            <RefreshIcon />
            {syncing ? 'Scanning…' : 'Run Discovery'}
          </button>
        )}
      </div>

      {discovery?.last && (
        <p className="discovery-meta">
          Last scan {formatWhen(discovery.last.at)}
          {discovery.last.ok
            ? ` — ${discovery.last.seen} container group(s) seen`
            : ` — failed: ${discovery.last.error}`}
          {discovery.enabled ? ` · every 5 minutes` : ' · scheduler disabled'}
        </p>
      )}

      {loading ? (
        <LoadingSpinner label="Loading applications…" />
      ) : error ? (
        <div className="error-state">
          <p>{error}</p>
        </div>
      ) : (
        <ApplicationTable
          applications={applications}
          isAdmin={isAdmin}
          initialFilter={initialFilter}
          onFilterChange={(value) => {
            const next = new URLSearchParams(searchParams);
            if (value === 'all') next.delete('filter');
            else next.set('filter', value);
            setSearchParams(next, { replace: true });
          }}
          onEdit={setEditing}
        />
      )}

      {/* Edit metadata (admins only) */}
      {isAdmin && (
        <ApplicationFormModal
          open={Boolean(editing)}
          application={editing}
          onClose={() => setEditing(null)}
          onSave={handleSave}
        />
      )}
    </div>
  );
}

function formatWhen(value) {
  if (!value) return 'never';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return 'never';
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins === 1) return '1 minute ago';
  if (mins < 60) return `${mins} minutes ago`;
  return d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function RefreshIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 12a9 9 0 1 1-3-6.7" />
      <path d="M21 3v6h-6" />
    </svg>
  );
}
