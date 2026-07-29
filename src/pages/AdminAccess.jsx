import { useState, useEffect, useCallback } from 'react';
import ConfirmDialog from '../components/ConfirmDialog.jsx';
import LoadingSpinner from '../components/LoadingSpinner.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import {
  getAdmins,
  addAdmin,
  removeAdmin,
  validateAdminEmail,
  normalizeEmail,
  ALLOWED_DOMAINS,
} from '../services/adminService.js';
import { formatDate } from '../utils/helpers.js';
// Reuses the shared data-table styling (.table-panel, .data-table, .row-action).
import '../components/ApplicationTable.css';
import './AdminAccess.css';

/**
 * Admin Access page (admins only): grant the Admin role to an email address
 * and revoke it again. Any well-formed address is accepted for now — the
 * domain allow-list in adminService is intentionally empty until the permitted
 * domains are confirmed.
 */
export default function AdminAccess() {
  const { user } = useAuth();
  const toast = useToast();

  const [admins, setAdmins] = useState([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [fieldError, setFieldError] = useState('');
  const [saving, setSaving] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState(null);
  const [revoking, setRevoking] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setAdmins(await getAdmins());
    } catch (err) {
      toast.error(err.message || 'Could not load the admin list.');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleAdd(e) {
    e.preventDefault();

    const problem = validateAdminEmail(email, admins);
    if (problem) {
      setFieldError(problem);
      return;
    }

    setFieldError('');
    setSaving(true);
    try {
      const created = await addAdmin(email);
      setAdmins((list) => [...list, created]);
      setEmail('');
      toast.success(`${created.email} now has admin access.`);
    } catch (err) {
      toast.error(err.message || 'Could not grant admin access.');
    } finally {
      setSaving(false);
    }
  }

  async function handleRevoke() {
    if (!revokeTarget) return;
    setRevoking(true);
    try {
      await removeAdmin(revokeTarget.id);
      setAdmins((list) => list.filter((a) => a.id !== revokeTarget.id));
      toast.success(`Admin access removed for ${revokeTarget.email}.`);
      setRevokeTarget(null);
    } catch (err) {
      toast.error(err.message || 'Could not remove admin access.');
    } finally {
      setRevoking(false);
    }
  }

  // Guard against an admin revoking their own access and locking themselves out.
  const isSelf = (admin) =>
    normalizeEmail(admin.email) === normalizeEmail(user?.email);

  return (
    <div className="admin-access-page">
      <header className="page-head">
        <div>
          <h1>Admin Access</h1>
          <p>
            Grant or remove admin access. Admins approve discovered applications
            and maintain their details; everyone else has read-only access.
          </p>
        </div>
      </header>

      {/* --- Grant form --- */}
      <section className="access-panel">
        <div className="access-panel-header">
          <h2>Grant admin access</h2>
          <p>
            {ALLOWED_DOMAINS.length > 0
              ? `Permitted domains: ${ALLOWED_DOMAINS.join(', ')}.`
              : 'Any valid email address can be added. Access applies the next time that person signs in.'}
          </p>
        </div>

        <form className="grant-form" onSubmit={handleAdd} noValidate>
          <div className="grant-field">
            <label htmlFor="admin-email">Email address</label>
            <input
              id="admin-email"
              type="email"
              placeholder="name@cloudfuze.com"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (fieldError) setFieldError('');
              }}
              className={fieldError ? 'has-error' : ''}
              aria-invalid={Boolean(fieldError)}
              aria-describedby={fieldError ? 'admin-email-error' : undefined}
              disabled={saving}
            />
            {fieldError && (
              <span className="field-error" id="admin-email-error" role="alert">
                {fieldError}
              </span>
            )}
          </div>

          <button className="btn btn--primary" type="submit" disabled={saving}>
            <PlusIcon />
            {saving ? 'Adding…' : 'Add Admin'}
          </button>
        </form>
      </section>

      {/* --- Current admins --- */}
      <section className="table-panel">
        <div className="table-toolbar">
          <strong className="panel-title">Current admins</strong>
          <span className="table-count">
            {admins.length} {admins.length === 1 ? 'admin' : 'admins'}
          </span>
        </div>

        {loading ? (
          <LoadingSpinner label="Loading admins…" />
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Added By</th>
                  <th>Added On</th>
                  <th className="col-actions">Actions</th>
                </tr>
              </thead>
              <tbody>
                {admins.length === 0 ? (
                  <tr>
                    <td className="empty-row" colSpan={4}>
                      No admins yet. Add an email address above.
                    </td>
                  </tr>
                ) : (
                  admins.map((admin) => (
                    <tr key={admin.id}>
                      <td className="cell-name">
                        {admin.email}
                        {isSelf(admin) && <span className="you-tag">You</span>}
                      </td>
                      <td>{admin.addedBy}</td>
                      <td>{formatDate(admin.addedAt)}</td>
                      <td className="col-actions">
                        <button
                          className="row-action row-action--danger"
                          onClick={() => setRevokeTarget(admin)}
                          disabled={isSelf(admin)}
                          title={
                            isSelf(admin)
                              ? 'You cannot remove your own access'
                              : 'Remove admin access'
                          }
                          aria-label={`Remove admin access for ${admin.email}`}
                        >
                          <TrashIcon />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <ConfirmDialog
        open={Boolean(revokeTarget)}
        title="Remove admin access"
        message={`Remove admin access for "${revokeTarget?.email}"? They will keep read-only access to the portal.`}
        confirmLabel="Remove"
        loading={revoking}
        onConfirm={handleRevoke}
        onCancel={() => setRevokeTarget(null)}
      />
    </div>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" />
    </svg>
  );
}
