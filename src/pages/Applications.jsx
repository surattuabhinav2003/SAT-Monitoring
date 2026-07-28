import { useState } from 'react';
import ApplicationTable from '../components/ApplicationTable.jsx';
import ApplicationFormModal from '../components/ApplicationFormModal.jsx';
import ConfirmDialog from '../components/ConfirmDialog.jsx';
import LoadingSpinner from '../components/LoadingSpinner.jsx';
import { useApplications } from '../hooks/useApplications.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import './Applications.css';

/**
 * Applications page: the professional data table plus admin-only create,
 * edit and delete flows.
 */
export default function Applications() {
  const { isAdmin } = useAuth();
  const toast = useToast();
  const {
    applications,
    loading,
    error,
    addApplication,
    editApplication,
    removeApplication,
  } = useApplications();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  function openCreate() {
    setEditing(null);
    setFormOpen(true);
  }

  function openEdit(app) {
    setEditing(app);
    setFormOpen(true);
  }

  async function handleSave(payload) {
    try {
      if (editing) {
        await editApplication(editing.id, payload);
        toast.success('Application updated successfully.');
      } else {
        await addApplication(payload);
        toast.success('Application created successfully.');
      }
      setFormOpen(false);
      setEditing(null);
    } catch (err) {
      toast.error(err.message || 'Could not save the application.');
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await removeApplication(deleteTarget.id);
      toast.success(`"${deleteTarget.name}" was deleted.`);
      setDeleteTarget(null);
    } catch (err) {
      toast.error(err.message || 'Could not delete the application.');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="applications-page">
      <div className="applications-header">
        <div className="page-heading">
          <h1>Applications</h1>
          <p>Monitor and manage all registered applications.</p>
        </div>
        {isAdmin && (
          <button className="btn btn--primary" onClick={openCreate}>
            <PlusIcon />
            Create Application
          </button>
        )}
      </div>

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
          onEdit={openEdit}
          onDelete={(app) => setDeleteTarget(app)}
        />
      )}

      {/* Create / edit modal (admins only) */}
      {isAdmin && (
        <ApplicationFormModal
          open={formOpen}
          initial={editing}
          onClose={() => {
            setFormOpen(false);
            setEditing(null);
          }}
          onSave={handleSave}
        />
      )}

      {/* Delete confirmation */}
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete application"
        message={`Are you sure you want to delete "${deleteTarget?.name}"? This action cannot be undone.`}
        confirmLabel="Delete"
        loading={deleting}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
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
