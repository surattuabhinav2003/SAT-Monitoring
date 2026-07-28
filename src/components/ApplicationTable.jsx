import { useState, useMemo } from 'react';
import { compareValues, prettyUrl } from '../utils/helpers.js';
import './ApplicationTable.css';

const PAGE_SIZE = 8;

const COLUMNS = [
  { key: 'name', label: 'Application Name' },
  { key: 'url', label: 'Application URL' },
  { key: 'team', label: 'Team Using' },
  { key: 'developedBy', label: 'Developed By' },
  { key: 'status', label: 'Status' },
  { key: 'decommissioned', label: 'Decommission Status' },
  { key: 'gstackImplemented', label: 'Gstack' },
];

/**
 * Data table with search, toolbar filters and pagination.
 * Admin-only edit/delete actions render when `isAdmin` is true.
 *
 * Rows are always ordered by application name; column sorting was removed at
 * the user's request, so the headers are plain labels.
 */
export default function ApplicationTable({ applications, isAdmin, onEdit, onDelete }) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [decommFilter, setDecommFilter] = useState('all');
  const [gstackFilter, setGstackFilter] = useState('all');
  const [page, setPage] = useState(1);

  // Derive the visible rows: filter -> search -> name order.
  const filtered = useMemo(() => {
    let rows = [...applications];

    if (statusFilter !== 'all') {
      rows = rows.filter((r) => r.status === statusFilter);
    }
    if (decommFilter !== 'all') {
      const wantDecomm = decommFilter === 'decommissioned';
      rows = rows.filter((r) => r.decommissioned === wantDecomm);
    }
    if (gstackFilter !== 'all') {
      const wantGstack = gstackFilter === 'implemented';
      rows = rows.filter((r) => Boolean(r.gstackImplemented) === wantGstack);
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      rows = rows.filter((r) =>
        [r.name, r.url, r.team, r.developedBy].some((v) =>
          v.toLowerCase().includes(q)
        )
      );
    }
    // Fixed, predictable order so pagination stays stable across renders.
    rows.sort((a, b) => compareValues(a.name, b.name, 'asc'));
    return rows;
  }, [applications, statusFilter, decommFilter, gstackFilter, search]);

  // Pagination math.
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageRows = filtered.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE
  );

  function resetToFirstPage(setter) {
    return (value) => {
      setter(value);
      setPage(1);
    };
  }

  return (
    <div className="table-panel">
      {/* Toolbar: search + filters */}
      <div className="table-toolbar">
        <div className="table-search">
          <SearchIcon />
          <input
            type="text"
            placeholder="Search applications…"
            value={search}
            onChange={(e) => resetToFirstPage(setSearch)(e.target.value)}
          />
        </div>

        <div className="table-filters">
          <select
            value={statusFilter}
            onChange={(e) => resetToFirstPage(setStatusFilter)(e.target.value)}
            aria-label="Filter by status"
          >
            <option value="all">All Statuses</option>
            <option value="Active">Active</option>
            <option value="Inactive">Inactive</option>
          </select>

          <select
            value={decommFilter}
            onChange={(e) => resetToFirstPage(setDecommFilter)(e.target.value)}
            aria-label="Filter by decommission status"
          >
            <option value="all">All Applications</option>
            <option value="active">Not Decommissioned</option>
            <option value="decommissioned">Decommissioned</option>
          </select>

          <select
            value={gstackFilter}
            onChange={(e) => resetToFirstPage(setGstackFilter)(e.target.value)}
            aria-label="Filter by gstack implementation"
          >
            <option value="all">All Gstack</option>
            <option value="implemented">Gstack Implemented</option>
            <option value="not-implemented">No Gstack Implemented</option>
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              {COLUMNS.map((col) => (
                <th key={col.key}>{col.label}</th>
              ))}
              {isAdmin && <th className="col-actions">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 ? (
              <tr>
                <td colSpan={isAdmin ? COLUMNS.length + 1 : COLUMNS.length} className="empty-row">
                  {applications.length === 0
                    ? 'No applications yet. Use “Create Application” to add one.'
                    : 'No applications match your filters.'}
                </td>
              </tr>
            ) : (
              pageRows.map((app) => (
                <tr key={app.id}>
                  <td className="cell-name">{app.name}</td>
                  <td>
                    <a
                      href={app.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="url-link"
                    >
                      {prettyUrl(app.url)}
                    </a>
                  </td>
                  <td>{app.team}</td>
                  <td>{app.developedBy}</td>
                  <td>
                    <span
                      className={`badge ${
                        app.status === 'Active' ? 'badge--active' : 'badge--inactive'
                      }`}
                    >
                      {app.status}
                    </span>
                  </td>
                  <td>
                    {/* This column answers only "is it decommissioned?" — the
                        Active/Inactive signal belongs to the Status column. */}
                    <span
                      className={`badge ${
                        app.decommissioned ? 'badge--decomm' : 'badge--not-decomm'
                      }`}
                    >
                      {app.decommissioned ? 'Decommissioned' : 'Not Decommissioned'}
                    </span>
                  </td>
                  <td>
                    <span
                      className={`badge ${
                        app.gstackImplemented ? 'badge--gstack' : 'badge--no-gstack'
                      }`}
                    >
                      {app.gstackImplemented ? 'Implemented' : 'Not Implemented'}
                    </span>
                  </td>
                  {isAdmin && (
                    <td className="col-actions">
                      <button
                        className="row-action"
                        onClick={() => onEdit(app)}
                        aria-label={`Edit ${app.name}`}
                        title="Edit"
                      >
                        <EditIcon />
                      </button>
                      <button
                        className="row-action row-action--danger"
                        onClick={() => onDelete(app)}
                        aria-label={`Delete ${app.name}`}
                        title="Delete"
                      >
                        <TrashIcon />
                      </button>
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Footer: result count + pagination */}
      <div className="table-footer">
        <span className="table-count">
          {filtered.length} application{filtered.length !== 1 ? 's' : ''}
        </span>
        <div className="pagination">
          <button
            className="page-btn"
            disabled={currentPage === 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Prev
          </button>
          {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
            <button
              key={p}
              className={`page-btn ${p === currentPage ? 'page-btn--active' : ''}`}
              onClick={() => setPage(p)}
            >
              {p}
            </button>
          ))}
          <button
            className="page-btn"
            disabled={currentPage === totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}

/* --- Inline icons --- */
function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
    </svg>
  );
}
function EditIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
    </svg>
  );
}
function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
    </svg>
  );
}
