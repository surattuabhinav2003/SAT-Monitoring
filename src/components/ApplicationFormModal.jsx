import { useState, useEffect } from 'react';
import Modal from './Modal.jsx';
import { getTeams } from '../services/applicationService.js';
import { parseTeams } from '../utils/helpers.js';
import './ApplicationFormModal.css';

const EMPTY = {
  team: '',
  developedBy: '',
  gstackImplemented: false,
  decommissioned: false,
  notes: '',
};

/**
 * Edit an application's BUSINESS METADATA.
 *
 * Name, URL and status are discovered from Docker and shown read-only — they
 * cannot be edited here, and the API ignores them if sent. Only the fields
 * admins own are editable.
 *
 * @param {object} application  The record being edited.
 * @param {Function} onSave  async (payload) => void
 */
export default function ApplicationFormModal({ open, application, onClose, onSave }) {
  const [form, setForm] = useState(EMPTY);
  const [submitting, setSubmitting] = useState(false);
  const [teams, setTeams] = useState([]);

  // Fetched once, not per open: the list rarely changes and this avoids a
  // request every time the modal is used.
  useEffect(() => {
    getTeams()
      .then(setTeams)
      .catch(() => setTeams([]));
  }, []);

  const selectedTeams = parseTeams(form.team);

  function toggleTeam(team) {
    const next = selectedTeams.includes(team)
      ? selectedTeams.filter((t) => t !== team)
      : [...selectedTeams, team];
    // Store in the configured order so the value is stable regardless of the
    // order boxes were ticked.
    const ordered = teams.filter((t) => next.includes(t));
    update('team', ordered.join(', '));
  }

  // Reset whenever the modal opens (or the record changes).
  useEffect(() => {
    if (open) {
      setForm({
        team: application?.team || '',
        developedBy: application?.developedBy || '',
        gstackImplemented: Boolean(application?.gstackImplemented),
        decommissioned: Boolean(application?.decommissioned),
        notes: application?.notes || '',
      });
      setSubmitting(false);
    }
  }, [open, application]);

  function update(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await onSave({
        team: form.team.trim(),
        developedBy: form.developedBy.trim(),
        gstackImplemented: form.gstackImplemented,
        decommissioned: form.decommissioned,
        notes: form.notes.trim(),
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} title="Edit Application Details" onClose={onClose} width={580}>
      <form className="app-form" onSubmit={handleSubmit} noValidate>
        {/* --- Discovered, read-only --- */}
        <div className="discovered-panel">
          <p className="discovered-title">
            Discovered from Docker
            <span className="discovered-hint">managed automatically</span>
          </p>
          <dl className="discovered-grid">
            <div>
              <dt>Application Name</dt>
              <dd>{application?.name || '—'}</dd>
            </div>
            <div>
              <dt>URL</dt>
              <dd className="discovered-url">{application?.url || '—'}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>{application?.status || '—'}</dd>
            </div>
            <div>
              <dt>Last Seen</dt>
              <dd>{formatSeen(application?.lastSeen)}</dd>
            </div>
          </dl>
        </div>

        {/* --- Admin-owned --- */}
        <div className="form-row">
          {/* Teams are a closed set, so this is a picker rather than free text —
              nobody can invent a ninth team by mistyping. */}
          <fieldset className="form-field team-picker">
            <legend>Team Using</legend>
            {teams.length === 0 ? (
              <p className="field-hint">Loading teams…</p>
            ) : (
              <div className="team-options">
                {teams.map((team) => {
                  const active = selectedTeams.includes(team);
                  return (
                    <label
                      key={team}
                      className={`team-option ${active ? 'is-active' : ''}`}
                    >
                      <input
                        type="checkbox"
                        checked={active}
                        onChange={() => toggleTeam(team)}
                      />
                      {team}
                    </label>
                  );
                })}
              </div>
            )}
            <span className="field-hint">
              {selectedTeams.length === 0
                ? 'Select every team that uses this application.'
                : `${selectedTeams.length} selected`}
            </span>
          </fieldset>

          <div className="form-field">
            <label htmlFor="developedBy">Developed By</label>
            <input
              id="developedBy"
              type="text"
              value={form.developedBy}
              onChange={(e) => update('developedBy', e.target.value)}
              placeholder="e.g. Platform Team"
            />
          </div>
        </div>

        <div className="form-row">
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
          <label htmlFor="notes">Notes</label>
          <textarea
            id="notes"
            rows={3}
            value={form.notes}
            onChange={(e) => update('notes', e.target.value)}
            placeholder="Context for the team — why it was decommissioned, who to contact, …"
          />
        </div>

        {/* Decommissioning is the only way an Inactive tool leaves the review
            queue, so make that explicit rather than leaving it implied. */}
        {application?.status === 'Inactive' && !form.decommissioned && (
          <p className="form-note">
            This application is <strong>Inactive</strong> — its container is not
            running. Restart it, or mark it Decommissioned to clear it from
            &ldquo;Requiring Review&rdquo;.
          </p>
        )}

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

function formatSeen(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}
