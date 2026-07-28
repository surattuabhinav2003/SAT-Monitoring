import { useState, useEffect, useMemo } from 'react';
import DashboardCard from '../components/DashboardCard.jsx';
import Modal from '../components/Modal.jsx';
import CategoryBarChart from '../components/CategoryBarChart.jsx';
import TeamPieChart from '../components/TeamPieChart.jsx';
import { getApplications } from '../services/applicationService.js';
import { useToast } from '../context/ToastContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
// Drill-down rows reuse the shared .badge styles.
import '../components/ApplicationTable.css';
import './Dashboard.css';

// Category definitions: label + predicate used both for counts and drill-down.
const CATEGORIES = {
  live: {
    title: 'Live Applications',
    match: (a) => a.status === 'Active' && !a.decommissioned,
  },
  decommissioned: {
    title: 'Decommissioned Applications',
    match: (a) => a.decommissioned,
  },
  inactive: {
    title: 'Inactive Applications',
    match: (a) => a.status === 'Inactive' && !a.decommissioned,
  },
  gstack: {
    title: 'Gstack Implemented',
    match: (a) => a.gstackImplemented,
  },
  noGstack: {
    title: 'No Gstack Implemented',
    match: (a) => !a.gstackImplemented,
  },
};

/**
 * Dashboard page. Every figure here derives from the applications an admin has
 * added — there is no seed data, so an empty portal shows zeros.
 *
 * Two sections: application status, and gstack implementation. Clicking any
 * card opens a popup listing the applications in that category.
 */
export default function Dashboard() {
  const { user } = useAuth();
  const toast = useToast();
  const [apps, setApps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeCategory, setActiveCategory] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const data = await getApplications();
        if (!cancelled) setApps(data);
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

  // Summary counts derived from the category predicates.
  const counts = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(CATEGORIES).map(([key, { match }]) => [
          key,
          apps.filter(match).length,
        ])
      ),
    [apps]
  );

  // Applications shown in the drill-down popup for the active category.
  const listForCategory = useMemo(() => {
    if (!activeCategory) return [];
    return apps.filter(CATEGORIES[activeCategory].match);
  }, [apps, activeCategory]);

  // Bar chart data — status distribution.
  const statusData = useMemo(
    () => [
      { label: 'Live', count: counts.live },
      { label: 'Decommissioned', count: counts.decommissioned },
      { label: 'Inactive', count: counts.inactive },
    ],
    [counts]
  );

  // Bar chart data — gstack implementation.
  const gstackData = useMemo(
    () => [
      { label: 'Implemented', count: counts.gstack },
      { label: 'Not Implemented', count: counts.noGstack },
    ],
    [counts]
  );

  // Pie chart data — team-wise usage.
  const teamData = useMemo(() => {
    const map = new Map();
    apps.forEach((a) => map.set(a.team, (map.get(a.team) || 0) + 1));
    return Array.from(map, ([team, count]) => ({ team, count }));
  }, [apps]);

  const isEmpty = !loading && apps.length === 0;

  return (
    <div className="dashboard">
      <div className="page-heading">
        <h1>Dashboard</h1>
        <p>
          Welcome back{user?.name ? `, ${user.name}` : ''}. Here&apos;s your
          application overview. Click any card to view its applications.
        </p>
      </div>

      {isEmpty && (
        <div className="dash-empty">
          <p>
            No applications have been added yet. Once an admin adds applications
            on the Applications page, the counts and charts below will fill in.
          </p>
        </div>
      )}

      {/* --- Section: application status --- */}
      <h2 className="dash-section-title">Application Status</h2>
      <div className="dash-cards dash-cards--three">
        <DashboardCard
          title="Live Applications"
          count={counts.live}
          variant="live"
          loading={loading}
          icon={<LiveIcon />}
          onClick={() => setActiveCategory('live')}
        />
        <DashboardCard
          title="Decommissioned Applications"
          count={counts.decommissioned}
          variant="decommissioned"
          loading={loading}
          icon={<DecommIcon />}
          onClick={() => setActiveCategory('decommissioned')}
        />
        <DashboardCard
          title="Inactive Applications"
          count={counts.inactive}
          variant="inactive"
          loading={loading}
          icon={<InactiveIcon />}
          onClick={() => setActiveCategory('inactive')}
        />
      </div>

      {/* --- Section: gstack implementation --- */}
      <h2 className="dash-section-title">Gstack Implementation</h2>
      <div className="dash-cards dash-cards--two">
        <DashboardCard
          title="Gstack Implemented"
          count={counts.gstack}
          variant="gstack"
          loading={loading}
          icon={<GstackIcon />}
          onClick={() => setActiveCategory('gstack')}
        />
        <DashboardCard
          title="No Gstack Implemented"
          count={counts.noGstack}
          variant="no-gstack"
          loading={loading}
          icon={<NoGstackIcon />}
          onClick={() => setActiveCategory('noGstack')}
        />
      </div>

      <div className="dash-charts">
        <CategoryBarChart
          title="Application Status Distribution"
          subtitle="Live, decommissioned and inactive applications"
          data={statusData}
          colors={['#20cc83', '#ff1f1f', '#fe5833']}
        />
        <CategoryBarChart
          title="Gstack Implementation"
          subtitle="Applications with and without gstack implemented"
          data={gstackData}
          colors={['#0129ac', '#9a9a9a']}
        />
        <div className="dash-chart-wide">
          <TeamPieChart data={teamData} />
        </div>
      </div>

      {/* Drill-down popup */}
      <Modal
        open={Boolean(activeCategory)}
        title={activeCategory ? CATEGORIES[activeCategory].title : ''}
        onClose={() => setActiveCategory(null)}
        width={720}
      >
        {listForCategory.length === 0 ? (
          <p className="drill-empty">No applications in this category.</p>
        ) : (
          <div className="drill-table-wrap">
            <table className="drill-table">
              <thead>
                <tr>
                  <th>Application Name</th>
                  <th>Developed By</th>
                  <th>Team Using</th>
                  <th>Gstack</th>
                </tr>
              </thead>
              <tbody>
                {listForCategory.map((app) => (
                  <tr key={app.id}>
                    <td className="drill-name">{app.name}</td>
                    <td>{app.developedBy}</td>
                    <td>{app.team}</td>
                    <td>
                      <span
                        className={`badge ${
                          app.gstackImplemented ? 'badge--gstack' : 'badge--no-gstack'
                        }`}
                      >
                        {app.gstackImplemented ? 'Implemented' : 'Not Implemented'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Modal>
    </div>
  );
}

/* --- Inline icons --- */
function LiveIcon() {
  return (
    <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <path d="M22 4L12 14.01l-3-3" />
    </svg>
  );
}
function DecommIcon() {
  return (
    <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10" />
      <path d="M4.93 4.93l14.14 14.14" />
    </svg>
  );
}
function InactiveIcon() {
  return (
    <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10" />
      <path d="M12 6v6l4 2" />
    </svg>
  );
}
function GstackIcon() {
  return (
    <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 3l9 4.5-9 4.5-9-4.5L12 3z" />
      <path d="M3 12l9 4.5 9-4.5" />
      <path d="M3 16.5L12 21l9-4.5" />
    </svg>
  );
}
function NoGstackIcon() {
  return (
    <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 3l9 4.5-9 4.5-9-4.5L12 3z" />
      <path d="M3 12l9 4.5 9-4.5" />
      <path d="M4 20L20 4" />
    </svg>
  );
}
