import { useState, useEffect } from 'react';
import Modal from './Modal.jsx';
import { isValidUrl } from '../utils/helpers.js';
import './ApplicationFormModal.css';

const EMPTY = {
  name: '',
  url: '',
  team: '',
  developedBy: '',
  status: 'Active',
  decommissioned: false,
  gstackImplemented: false,
};

/**
 * Create / edit form for an application, rendered inside a centered modal.
 * @param {object|null} initial  Existing record when editing, null when creating.
 * @param {Function} onSave  async (payload) => void
 */
export default function ApplicationFormModal({ open, initial, onClose, onSave }) {
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);

  const isEdit = Boolean(initial);

  // Reset the form whenever the modal opens (or the record changes).
  useEffect(() => {
    if (open) {
      setForm(initial ? { ...initial } : EMPTY);
      setErrors({});
      setSubmitting(false);
    }
  }, [open, initial]);

  function update(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => ({ ...prev, [field]: undefined }));
  }

  function validate() {
    const next = {};
    if (!form.name.trim()) next.name = 'Application name is required.';
    if (!form.url.trim()) next.url = 'Application URL is required.';
    else if (!isValidUrl(form.url.trim())) next.url = 'Enter a valid http(s) URL.';
    if (!form.team.trim()) next.team = 'Team is required.';
    if (!form.developedBy.trim()) next.developedBy = 'Developed by is required.';
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!validate()) return;
    setSubmitting(true);
    try {
      await onSave({
        ...form,
        name: form.name.trim(),
        url: form.url.trim(),
        team: form.team.trim(),
        developedBy: form.developedBy.trim(),
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open={open}
      title={isEdit ? 'Edit Application' : 'Create Application'}
      onClose={onClose}
      width={560}
    >
      <form className="app-form" onSubmit={handleSubmit} noValidate>
        <div className="form-field">
          <label htmlFor="name">Application Name</label>
          <input
            id="name"
            type="text"
            value={form.name}
            onChange={(e) => update('name', e.target.value)}
            placeholder="e.g. Migration Console"
            className={errors.name ? 'has-error' : ''}
          />
          {errors.name && <span className="field-error">{errors.name}</span>}
        </div>

        <div className="form-field">
          <label htmlFor="url">Application URL</label>
          <input
            id="url"
            type="text"
            value={form.url}
            onChange={(e) => update('url', e.target.value)}
            placeholder="https://app.example.com"
            className={errors.url ? 'has-error' : ''}
          />
          {errors.url && <span className="field-error">{errors.url}</span>}
        </div>

        <div className="form-row">
          <div className="form-field">
            <label htmlFor="team">Team Using</label>
            <input
              id="team"
              type="text"
              value={form.team}
              onChange={(e) => update('team', e.target.value)}
              placeholder="e.g. Analytics"
              className={errors.team ? 'has-error' : ''}
            />
            {errors.team && <span className="field-error">{errors.team}</span>}
          </div>

          <div className="form-field">
            <label htmlFor="developedBy">Developed By</label>
            <input
              id="developedBy"
              type="text"
              value={form.developedBy}
              onChange={(e) => update('developedBy', e.target.value)}
              placeholder="e.g. Platform Team"
              className={errors.developedBy ? 'has-error' : ''}
            />
            {errors.developedBy && <span className="field-error">{errors.developedBy}</span>}
          </div>
        </div>

        <div className="form-row">
          <div className="form-field">
            <label htmlFor="status">Status</label>
            <select
              id="status"
              value={form.status}
              onChange={(e) => update('status', e.target.value)}
            >
              <option value="Active">Active</option>
              <option value="Inactive">Inactive</option>
            </select>
          </div>

          <div className="form-field">
            <label htmlFor="decommissioned">Decommission Status</label>
            <select
              id="decommissioned"
              value={form.decommissioned ? 'yes' : 'no'}
              onChange={(e) => update('decommissioned', e.target.value === 'yes')}
            >
              <option value="no">Not Decommissioned</option>
              <option value="yes">Decommissioned</option>
            </select>
          </div>
        </div>

        <div className="form-field">
          <label htmlFor="gstackImplemented">Gstack</label>
          <select
            id="gstackImplemented"
            value={form.gstackImplemented ? 'yes' : 'no'}
            onChange={(e) => update('gstackImplemented', e.target.value === 'yes')}
          >
            <option value="yes">Gstack Implemented</option>
            <option value="no">No Gstack Implemented</option>
          </select>
        </div>

        <div className="form-actions">
          <button
            type="button"
            className="btn btn--ghost"
            onClick={onClose}
            disabled={submitting}
          >
            Cancel
          </button>
          <button type="submit" className="btn btn--primary" disabled={submitting}>
            {submitting ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
