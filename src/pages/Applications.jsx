import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import ApplicationTable from '../components/ApplicationTable.jsx';
import ApplicationFormModal from '../components/ApplicationFormModal.jsx';
import LoadingSpinner from '../components/LoadingSpinner.jsx';
import Modal from '../components/Modal.jsx';
import { useApplications } from '../hooks/useApplications.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import {
  runDiscovery,
  getDiscoveryState,
  approveApplication,
  setApplicationUrl,
} from '../services/applicationService.js';
import './Applications.css';

/**
 * Applications page.
 *
 * The inventory is discovered from Docker — there is no create and no delete.
 * Admins approve new records, supply URLs discovery could not map, and maintain
 * business metadata.
 */
export default function Applications() {
  const { isAdmin, canRunDiscovery } = useAuth();
  const toast = useToast();
  const { applications, loading, error, reload, editApplication, replaceApplication } =
    useApplications();

  const [searchParams, setSearchParams] = useSearchParams();
  const [editing, setEditing] = useState(null);
  const [mapping, setMapping] = useState(null);
  const [mappingUrl, setMappingUrl] = useState('');
  const [savingUrl, setSavingUrl] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [discovery, setDiscovery] = useState(null);

  const initialFilter = searchParams.get('filter') || 'all';

  const loadDiscovery = useCallback(async () => {
    try {
      setDiscovery(await getDiscoveryState());
    } catch {
      setDiscovery(null);
    }
  }, []);

  useEffect(() => {
    loadDiscovery();
  }, [loadDiscovery]);

  async function handleSave(payload) {
    try {
      await editApplication(editing.id, payload);
      toast.success('Application details updated.');
      setEditing(null);
    } catch (err) {
      toast.error(err.message || 'Could not save the application.');
    }
  }

  async function handleApprove(app) {
    try {
      const updated = await approveApplication(app.id);
      replaceApplication(updated);
      toast.success(`${app.name} approved.`);
    } catch (err) {
      toast.error(err.message || 'Could not approve the application.');
    }
  }

  async function handleSaveUrl(e) {
    e.preventDefault();
    setSavingUrl(true);
    try {
      const updated = await setApplicationUrl(mapping.id, mappingUrl.trim());
      replaceApplication(updated);
      toast.success('URL saved.');
      setMapping(null);
      setMappingUrl('');
    } catch (err) {
      toast.error(err.message || 'Could not save the URL.');
    } finally {
      setSavingUrl(false);
    }
  }

  /**
   * Runs a discovery pass. The scan happens in the worker, but the API waits for
   * it, so the result is reported directly rather than guessed at after a delay.
   */
  async function handleRequestScan() {
    setRequesting(true);
    try {
      const run = await runDiscovery();
      const parts = [
        `${run.containersScanned} container${run.containersScanned === 1 ? '' : 's'} scanned`,
      ];
      if (run.applicationsDiscovered > 0) parts.push(`${run.applicationsDiscovered} new`);
      if (run.applicationsReactivated > 0) parts.push(`${run.applicationsReactivated} restored`);
      if (run.applicationsDeactivated > 0) parts.push(`${run.applicationsDeactivated} stopped`);
      if (run.needsMapping > 0) parts.push(`${run.needsMapping} needing a URL`);

      toast.success(`Discovery complete — ${parts.join(', ')}.`);
      await Promise.all([reload(), loadDiscovery()]);
    } catch (err) {
      toast.error(err.message || 'Discovery failed.');
    } finally {
      setRequesting(false);
    }
  }

  const latest = discovery?.latestRun;

  return (
    <div className="applications-page">
      <header className="page-head">
        <div>
          <h1>Applications</h1>
          <p>
            Discovered automatically from Docker. Approve new entries and maintain
            the business details — team, owner, gstack and decommission status.
          </p>
        </div>

        <div className="page-head-actions">
          {latest && (
            <span className={`run-chip ${latest.errors ? 'run-chip--bad' : ''}`}>
              <span className="run-dot" aria-hidden="true" />
              {latest.errors ? (
                'Discovery failing'
              ) : (
                <>
                  Scanned {formatWhen(latest.startedAt)}
                  <em>{latest.containersScanned} containers</em>
                </>
              )}
            </span>
          )}
          {canRunDiscovery && (
            <button
              className="btn btn--primary"
              onClick={handleRequestScan}
              disabled={requesting}
            >
              <RefreshIcon className={requesting ? 'is-spinning' : ''} />
              {requesting ? 'Scanning…' : 'Run Discovery'}
            </button>
          )}
        </div>
      </header>

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
          onApprove={handleApprove}
          onSetUrl={(app) => {
            setMapping(app);
            setMappingUrl('');
          }}
        />
      )}

      {isAdmin && (
        <ApplicationFormModal
          open={Boolean(editing)}
          application={editing}
          onClose={() => setEditing(null)}
          onSave={handleSave}
        />
      )}

      {/* Supply a hostname discovery could not determine. */}
      <Modal
        open={Boolean(mapping)}
        title="Set Application URL"
        onClose={() => setMapping(null)}
        width={520}
      >
        <form className="app-form" onSubmit={handleSaveUrl} noValidate>
          <p className="form-note">
            Discovery found no <code>sat.url</code> label on{' '}
            <strong>{mapping?.name}</strong> and no matching nginx route, so it did
            not guess a hostname. Add one here, or add a <code>sat.url</code> label
            to the container so it is picked up automatically next time.
          </p>
          <div className="form-field">
            <label htmlFor="map-url">Hostname or URL</label>
            <input
              id="map-url"
              type="text"
              value={mappingUrl}
              onChange={(e) => setMappingUrl(e.target.value)}
              placeholder="tool.cftools.live"
              autoFocus
            />
          </div>
          <div className="form-actions">
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => setMapping(null)}
              disabled={savingUrl}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn--primary"
              disabled={savingUrl || !mappingUrl.trim()}
            >
              {savingUrl ? 'Saving…' : 'Save URL'}
            </button>
          </div>
        </form>
      </Modal>
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
  return d.toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function RefreshIcon({ className }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="M21 12a9 9 0 1 1-3-6.7" />
      <path d="M21 3v6h-6" />
    </svg>
  );
}
