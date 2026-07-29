import { useState, useMemo, useEffect, useRef } from 'react';
import {
  compareValues,
  prettyUrl,
  shortHost,
  commonHostSuffix,
  parseTeams,
  lifecycleOf,
  liveStateOf,
  badgeClassFor,
} from '../utils/helpers.js';
import './ApplicationTable.css';

const PAGE_SIZE = 8;

/**
 * Headings are kept short so all eight columns fit without a horizontal
 * scrollbar once the sidebar is expanded. `className` drives per-column width
 * and truncation.
 */
const COLUMNS = [
  { key: 'name', label: 'Application', className: 'col-name' },
  { key: 'url', label: 'Link', className: 'col-url' },
  { key: 'team', label: 'Team Using', className: 'col-teams' },
  { key: 'developedBy', label: 'Developed By', className: 'col-text' },
  { key: 'status', label: 'Status' },
  { key: 'decommissioned', label: 'Decommissioned' },
  { key: 'gstackImplemented', label: 'Gstack' },
];

/**
 * Data table with search, filters and pagination.
 *
 * Applications are discovered, so there is no delete action — inventory history
 * is permanent. Admins get edit, plus approve for pending records and a URL
 * prompt for ones discovery could not map.
 */
export default function ApplicationTable({
  applications,
  isAdmin,
  onEdit,
  onApprove,
  onSetUrl,
  initialFilter = 'all',
  onFilterChange,
}) {
  const [search, setSearch] = useState('');
  const [lifecycleFilter, setLifecycleFilter] = useState(initialFilter);
  const [gstackFilter, setGstackFilter] = useState('all');
  const [page, setPage] = useState(1);

  useEffect(() => {
    setLifecycleFilter(initialFilter);
    setPage(1);
  }, [initialFilter]);

  const filtered = useMemo(() => {
    let rows = [...applications];

    if (lifecycleFilter !== 'all') {
      rows = rows.filter((r) => {
        switch (lifecycleFilter) {
          case 'pending':
            return r.pendingReview;
          case 'review':
            return r.needsReview;
          case 'mapping':
            return r.needsMapping;
          case 'incomplete':
            return !r.team || !r.developedBy;
          default:
            return lifecycleOf(r).toLowerCase() === lifecycleFilter;
        }
      });
    }
    if (gstackFilter !== 'all') {
      const wantGstack = gstackFilter === 'implemented';
      rows = rows.filter((r) => Boolean(r.gstackImplemented) === wantGstack);
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      rows = rows.filter((r) =>
        // Guarded: one missing field would otherwise throw and blank the table.
        [r.name, r.url, r.team, r.developedBy].some((v) =>
          String(v ?? '').toLowerCase().includes(q)
        )
      );
    }

    rows.sort((a, b) => compareValues(a.name, b.name, 'asc'));
    return rows;
  }, [applications, lifecycleFilter, gstackFilter, search]);

  /**
   * Domain every application shares, if any — computed across the WHOLE list,
   * not the current page, so the column does not change meaning as you paginate
   * or filter.
   */
  const sharedDomain = useMemo(
    () => commonHostSuffix(applications.map((a) => prettyUrl(a.url)).filter(Boolean)),
    [applications]
  );

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageRows = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  function resetToFirstPage(setter) {
    return (value) => {
      setter(value);
      setPage(1);
    };
  }

  function changeLifecycle(value) {
    setLifecycleFilter(value);
    setPage(1);
    onFilterChange?.(value);
  }

  return (
    <div className="table-panel">
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
            value={lifecycleFilter}
            onChange={(e) => changeLifecycle(e.target.value)}
            aria-label="Filter by lifecycle state"
          >
            <option value="all">All Applications</option>
            <option value="pending">Pending Review</option>
            <option value="active">Active</option>
            <option value="warning">Warning</option>
            <option value="review">Requiring Review</option>
            <option value="mapping">Needs Mapping</option>
            <option value="decommissioned">Decommissioned</option>
            <option value="incomplete">Missing Details</option>
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

      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              {COLUMNS.map((col) => (
                <th key={col.key} className={col.className}>
                  {col.label}
                </th>
              ))}
              {isAdmin && <th className="col-actions">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 ? (
              <tr>
                <td
                  colSpan={isAdmin ? COLUMNS.length + 1 : COLUMNS.length}
                  className="empty-row"
                >
                  {applications.length === 0
                    ? 'No applications discovered yet. The worker scans Docker every 5 minutes.'
                    : 'No applications match your filters.'}
                </td>
              </tr>
            ) : (
              pageRows.map((app) => {
                // Live state and the decommission decision are shown in their own
                // columns; each answers a different question.
                const live = liveStateOf(app);
                return (
                  <tr key={app.id} className={app.pendingReview ? 'row--pending' : ''}>
                    <td className="cell-name col-name" title={app.name}>
                      {app.name}
                      {(!app.team || !app.developedBy) && !app.pendingReview && (
                        <span className="needs-detail" title="Team / Developed By not set">
                          !
                        </span>
                      )}
                    </td>
                    <td className="col-url">
                      {app.url ? (
                        <a
                          href={app.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="url-link"
                          // The shortened text is for scanning; the tooltip and
                          // the link itself always carry the full address.
                          title={app.url}
                        >
                          <span className="url-text">
                            {shortHost(prettyUrl(app.url), sharedDomain)}
                          </span>
                          {/* Signals that the link leaves the portal, which the
                              target="_blank" behaviour otherwise gives no warning of. */}
                          <ExternalIcon />
                          {app.urlSource && (
                            <span className="url-source" title={`Resolved from ${app.urlSource}`}>
                              {app.urlSource}
                            </span>
                          )}
                        </a>
                      ) : (
                        <span className="badge badge--mapping" title="No sat.url label and no nginx route found">
                          Needs Mapping
                        </span>
                      )}
                    </td>
                    <td className="col-teams">
                      <TeamChips value={app.team} />
                    </td>
                    <td className="col-text" title={app.developedBy || ''}>
                      {app.developedBy || <span className="cell-empty">—</span>}
                    </td>
                    <td>
                      <span className={`badge ${badgeClassFor(live)}`}>{live}</span>
                      {/* Raw Docker health, kept visible for diagnosis. */}
                      {app.healthStatus && app.healthStatus !== 'none' && (
                        <span className="health-note" title="Docker HEALTHCHECK state">
                          {app.healthStatus}
                        </span>
                      )}
                    </td>
                    <td>
                      {/* Admin-owned. The heading supplies the subject, so the cell
                          only has to answer it. Neutral on "No" so it does not echo
                          the green Active signal from the Status column. */}
                      <span
                        className={`badge ${
                          app.decommissioned ? 'badge--decomm' : 'badge--not-decomm'
                        }`}
                        title={
                          app.decommissioned
                            ? 'Decommissioned by an admin'
                            : 'Not decommissioned — still in service'
                        }
                      >
                        {app.decommissioned ? 'Yes' : 'No'}
                      </span>
                      {/* Decommissioned but still running — the container should
                          have been stopped, so surface it rather than hide it. */}
                      {app.decommissioned && app.status === 'Active' && (
                        <span
                          className="health-note health-note--alert"
                          title="Marked decommissioned but the container is still running"
                        >
                          still running
                        </span>
                      )}
                    </td>
                    <td>
                      {/* "Yes"/"No" rather than "Implemented"/"Not Implemented":
                          the column heading already supplies the subject, and the
                          long form cost enough width to push the table into a
                          horizontal scrollbar. */}
                      <span
                        className={`badge ${
                          app.gstackImplemented ? 'badge--gstack' : 'badge--no-gstack'
                        }`}
                        title={app.gstackImplemented ? 'Gstack implemented' : 'Gstack not implemented'}
                      >
                        {app.gstackImplemented ? 'Yes' : 'No'}
                      </span>
                    </td>
                    {isAdmin && (
                      <td className="col-actions">
                        {app.pendingReview && (
                          <button
                            className="row-action row-action--approve"
                            onClick={() => onApprove(app)}
                            title="Approve this application"
                            aria-label={`Approve ${app.name}`}
                          >
                            <CheckIcon />
                          </button>
                        )}
                        {app.needsMapping && (
                          <button
                            className="row-action"
                            onClick={() => onSetUrl(app)}
                            title="Set the URL"
                            aria-label={`Set URL for ${app.name}`}
                          >
                            <LinkIcon />
                          </button>
                        )}
                        <button
                          className="row-action"
                          onClick={() => onEdit(app)}
                          aria-label={`Edit details for ${app.name}`}
                          title="Edit details"
                        >
                          <EditIcon />
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

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

/** How many team chips to show before collapsing the rest into a counter. */
const TEAM_CHIP_LIMIT = 2;

/**
 * Teams as chips, with a fixed visual budget.
 *
 * An application may be used by several teams. Rendering all of them would make
 * row heights uneven and widen the table, so the first two are shown and the rest
 * collapse into a "+6" counter. Clicking the counter opens the full list — a
 * tooltip alone was not enough, since it needs a mouse and cannot be reached by
 * keyboard or touch.
 */
function TeamChips({ value }) {
  const teams = parseTeams(value);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const btnRef = useRef(null);
  const popRef = useRef(null);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(e) {
      if (
        !popRef.current?.contains(e.target) &&
        !btnRef.current?.contains(e.target)
      ) {
        setOpen(false);
      }
    }
    function onKey(e) {
      if (e.key === 'Escape') {
        setOpen(false);
        btnRef.current?.focus();
      }
    }
    // The popover is positioned from a one-off measurement, so it would drift if
    // the page moved underneath it.
    function onReflow() {
      setOpen(false);
    }

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onReflow);
    window.addEventListener('scroll', onReflow, true);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onReflow);
      window.removeEventListener('scroll', onReflow, true);
    };
  }, [open]);

  if (teams.length === 0) return <span className="cell-empty">—</span>;

  const shown = teams.slice(0, TEAM_CHIP_LIMIT);
  const hidden = teams.slice(TEAM_CHIP_LIMIT);

  function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    const rect = btnRef.current.getBoundingClientRect();
    const width = 230;
    setPos({
      top: rect.bottom + 6,
      // Clamp so the panel cannot hang off the right edge of the window.
      left: Math.min(rect.left, window.innerWidth - width - 12),
      width,
    });
    setOpen(true);
  }

  return (
    <span className="team-chips">
      {shown.map((team) => (
        <span key={team} className="team-chip">
          {team}
        </span>
      ))}

      {hidden.length > 0 && (
        <>
          <button
            ref={btnRef}
            type="button"
            className={`team-chip team-chip--more ${open ? 'is-open' : ''}`}
            onClick={toggle}
            aria-expanded={open}
            aria-label={`Show all ${teams.length} teams`}
          >
            +{hidden.length}
          </button>

          {/* Fixed position, because the cell clips its overflow — an absolutely
              positioned panel would be cut off by the column. */}
          {open && pos && (
            <div
              ref={popRef}
              className="team-pop"
              style={{ top: pos.top, left: pos.left, width: pos.width }}
              role="dialog"
              aria-label="Teams using this application"
            >
              <p className="team-pop-head">
                Teams using this
                <span>{teams.length}</span>
              </p>
              <div className="team-pop-body">
                {teams.map((team) => (
                  <span key={team} className="team-chip">
                    {team}
                  </span>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </span>
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
function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2">
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}
/** Small "opens in a new tab" arrow shown inside each application link. */
function ExternalIcon() {
  return (
    <svg
      className="url-ext"
      viewBox="0 0 24 24"
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      aria-hidden="true"
    >
      <path d="M7 17L17 7" />
      <path d="M9 7h8v8" />
    </svg>
  );
}

function LinkIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.8 1.8" />
      <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.8-1.8" />
    </svg>
  );
}
