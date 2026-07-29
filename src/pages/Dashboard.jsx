import { useState, useEffect, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import StatTile from '../components/StatTile.jsx';
import ProportionBar from '../components/ProportionBar.jsx';
import TeamBars from '../components/TeamBars.jsx';
import Modal from '../components/Modal.jsx';
import { getApplications, getDiscoveryState } from '../services/applicationService.js';
import { useToast } from '../context/ToastContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { lifecycleOf, badgeClassFor } from '../utils/helpers.js';
import '../components/ApplicationTable.css'; // shared .badge styles
import './Dashboard.css';

/** Brand-consistent colours. Semantic only where the meaning is semantic. */
const C = {
  live: '#20cc83',
  warning: '#fe5833',
  inactive: '#9a9a9a',
  decommissioned: '#ff1f1f',
  gstack: '#0129ac',
  noGstack: '#c9cbe0',
};

// Category definitions: label + predicate, used for counts and drill-down.
const CATEGORIES = {
  live: { title: 'Live Applications', match: (a) => a.status === 'Active' && !a.decommissioned },
  warning: { title: 'Unhealthy Applications', match: (a) => a.status === 'Warning' && !a.decommissioned },
  inactive: { title: 'Inactive Applications', match: (a) => a.status === 'Inactive' && !a.decommissioned },
  decommissioned: { title: 'Decommissioned Applications', match: (a) => a.decommissioned },
  review: { title: 'Applications Requiring Review', match: (a) => a.needsReview },
  pending: { title: 'Awaiting Approval', match: (a) => a.pendingReview },
  mapping: { title: 'Needing URL Mapping', match: (a) => a.needsMapping },
  gstack: { title: 'Gstack Implemented', match: (a) => a.gstackImplemented },
  noGstack: { title: 'No Gstack Implemented', match: (a) => !a.gstackImplemented },
  all: { title: 'All Applications', match: () => true },
};

/**
 * Dashboard. Discovered inventory at a glance: what needs attention first, then
 * the health and gstack breakdowns, then team ownership.
 */
export default function Dashboard() {
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  const [apps, setApps] = useState([]);
  const [latestRun, setLatestRun] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeCategory, setActiveCategory] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const [data, state] = await Promise.all([
          getApplications(),
          getDiscoveryState().catch(() => null), // non-fatal
        ]);
        if (!cancelled) {
          setApps(data);
          setLatestRun(state?.latestRun || null);
        }
      } catch (err) {
        toast.error(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const counts = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(CATEGORIES).map(([key, { match }]) => [key, apps.filter(match).length])
      ),
    [apps]
  );

  const listForCategory = useMemo(() => {
    if (!activeCategory) return [];
    return apps.filter(CATEGORIES[activeCategory].match);
  }, [apps, activeCategory]);

  const teamData = useMemo(() => {
    // Grouped case-insensitively; the first spelling seen becomes the label.
    const map = new Map();
    apps.forEach((a) => {
      const raw = (a.team || '').trim();
      if (!raw) return;
      const key = raw.toLowerCase();
      const existing = map.get(key);
      if (existing) existing.count += 1;
      else map.set(key, { team: raw, count: 1 });
    });
    return Array.from(map.values());
  }, [apps]);

  const untagged = apps.filter((a) => !a.team).length;
  const attention = counts.pending + counts.mapping + counts.review;
  const isEmpty = !loading && apps.length === 0;

  return (
    <div className="dashboard">
      {/* ---------- Header ---------- */}
      <header className="page-head">
        <div>
          <h1>Dashboard</h1>
          <p>
            {user?.name ? `Welcome back, ${user.name}. ` : ''}
            Your internal application inventory, discovered from Docker.
          </p>
        </div>
        {latestRun && (
          <span className={`run-chip ${latestRun.errors ? 'run-chip--bad' : ''}`}>
            <span className="run-dot" aria-hidden="true" />
            {latestRun.errors ? (
              <>Discovery failing</>
            ) : (
              <>
                Scanned {relativeTime(latestRun.startedAt)}
                <em>{latestRun.containersScanned} containers</em>
              </>
            )}
          </span>
        )}
      </header>

      {isEmpty && (
        <div className="notice">
          <p>
            No applications discovered yet. The worker scans Docker every 5
            minutes — new containers appear here for approval.
          </p>
        </div>
      )}

      {/* ---------- Needs attention ---------- */}
      {attention > 0 && (
        <section className="attention">
          <h2 className="section-label">Needs your attention</h2>
          <div className="attention-grid">
            {counts.pending > 0 && (
              <Link to="/applications?filter=pending" className="act act--info">
                <strong>{counts.pending}</strong>
                <span>
                  {counts.pending === 1 ? 'New application' : 'New applications'} awaiting approval
                  <small>Discovered from Docker, not yet confirmed</small>
                </span>
              </Link>
            )}
            {counts.mapping > 0 && (
              <Link to="/applications?filter=mapping" className="act act--warn">
                <strong>{counts.mapping}</strong>
                <span>
                  {counts.mapping === 1 ? 'Application needs' : 'Applications need'} a URL
                  <small>No sat.url label and no nginx route</small>
                </span>
              </Link>
            )}
            {counts.review > 0 && (
              <Link to="/applications?filter=review" className="act act--warn">
                <strong>{counts.review}</strong>
                <span>
                  {counts.review === 1 ? 'Application requires' : 'Applications require'} review
                  <small>Not running, not decommissioned</small>
                </span>
              </Link>
            )}
          </div>
        </section>
      )}

      {/* ---------- KPI row ---------- */}
      <section>
        <h2 className="section-label">Inventory</h2>
        <div className="kpi-grid">
          <StatTile
            label="Total tracked"
            value={counts.all}
            tone="accent"
            loading={loading}
            icon={<GridIcon />}
            onClick={() => setActiveCategory('all')}
          />
          <StatTile
            label="Live"
            value={counts.live}
            tone="success"
            loading={loading}
            icon={<LiveIcon />}
            onClick={() => setActiveCategory('live')}
          />
          <StatTile
            label="Unhealthy"
            value={counts.warning}
            tone="warning"
            loading={loading}
            icon={<WarnIcon />}
            hint={counts.warning > 0 ? 'Failing healthcheck' : undefined}
            onClick={() => setActiveCategory('warning')}
          />
          <StatTile
            label="Inactive"
            value={counts.inactive}
            tone="danger"
            loading={loading}
            icon={<StopIcon />}
            onClick={() => setActiveCategory('inactive')}
          />
          <StatTile
            label="Decommissioned"
            value={counts.decommissioned}
            tone="muted"
            loading={loading}
            icon={<ArchiveIcon />}
            onClick={() => setActiveCategory('decommissioned')}
          />
        </div>
      </section>

      {/* ---------- Breakdowns ---------- */}
      <section>
        <h2 className="section-label">Breakdown</h2>
        <div className="split-grid">
          <ProportionBar
            title="Application Status"
            subtitle="Current state of every tracked application"
            emptyLabel="Nothing discovered yet."
            segments={[
              { label: 'Live', value: counts.live, color: C.live, onClick: () => setActiveCategory('live') },
              { label: 'Unhealthy', value: counts.warning, color: C.warning, onClick: () => setActiveCategory('warning') },
              { label: 'Inactive', value: counts.inactive, color: C.inactive, onClick: () => setActiveCategory('inactive') },
              { label: 'Decommissioned', value: counts.decommissioned, color: C.decommissioned, onClick: () => setActiveCategory('decommissioned') },
            ]}
          />
          <ProportionBar
            title="Gstack Implementation"
            subtitle="Applications with and without gstack"
            emptyLabel="Nothing discovered yet."
            segments={[
              { label: 'Implemented', value: counts.gstack, color: C.gstack, onClick: () => setActiveCategory('gstack') },
              { label: 'Not implemented', value: counts.noGstack, color: C.noGstack, onClick: () => setActiveCategory('noGstack') },
            ]}
          />
        </div>
      </section>

      {/* ---------- Ownership ---------- */}
      <section>
        <h2 className="section-label">Ownership</h2>
        <TeamBars
          data={teamData}
          onSelect={(team) => navigate(`/applications?q=${encodeURIComponent(team)}`)}
        />
        {untagged > 0 && (
          <p className="section-foot">
            <Link to="/applications?filter=incomplete">
              {untagged} application{untagged === 1 ? '' : 's'} without a team
            </Link>{' '}
            — set “Team Using” so they appear here.
          </p>
        )}
      </section>

      {/* ---------- Drill-down ---------- */}
      <Modal
        open={Boolean(activeCategory)}
        title={activeCategory ? CATEGORIES[activeCategory].title : ''}
        onClose={() => setActiveCategory(null)}
        width={760}
      >
        {listForCategory.length === 0 ? (
          <p className="drill-empty">No applications in this category.</p>
        ) : (
          <div className="drill-table-wrap">
            <table className="drill-table">
              <thead>
                <tr>
                  <th>Application</th>
                  <th>Team</th>
                  <th>Developed By</th>
                  <th>State</th>
                  <th>Gstack</th>
                </tr>
              </thead>
              <tbody>
                {listForCategory.map((app) => {
                  const state = lifecycleOf(app);
                  return (
                    <tr key={app.id}>
                      <td className="drill-name">{app.name}</td>
                      <td>{app.team || <span className="cell-empty">—</span>}</td>
                      <td>{app.developedBy || <span className="cell-empty">—</span>}</td>
                      <td>
                        <span className={`badge ${badgeClassFor(state)}`}>{state}</span>
                      </td>
                      <td>
                        <span
                          className={`badge ${
                            app.gstackImplemented ? 'badge--gstack' : 'badge--no-gstack'
                          }`}
                        >
                          {app.gstackImplemented ? 'Yes' : 'No'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Modal>
    </div>
  );
}

function relativeTime(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return 'recently';
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins === 1) return '1 min ago';
  if (mins < 60) return `${mins} mins ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hr${hours === 1 ? '' : 's'} ago`;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

/* --- Icons --- */
function GridIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  );
}
function LiveIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <path d="M22 4L12 14.01l-3-3" />
    </svg>
  );
}
function WarnIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 9v4M12 17h.01" />
      <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
    </svg>
  );
}
function StopIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10" />
      <path d="M4.93 4.93l14.14 14.14" />
    </svg>
  );
}
function ArchiveIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="4" width="18" height="4" rx="1" />
      <path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8" />
      <path d="M10 12h4" />
    </svg>
  );
}
