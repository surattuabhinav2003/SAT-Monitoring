import './DashboardCard.css';

/**
 * Large summary card for the dashboard.
 * @param {string} title  Card heading (e.g. "Live Applications").
 * @param {number} count  The metric value.
 * @param {string} variant  Color theme: 'live' | 'decommissioned' | 'inactive'.
 * @param {ReactNode} icon  Icon element.
 * @param {boolean} loading  Show a skeleton while data loads.
 * @param {Function} [onClick]  When provided, the card becomes an interactive
 *   button that opens the drill-down list for this category.
 */
export default function DashboardCard({ title, count, variant, icon, loading, onClick }) {
  const clickable = typeof onClick === 'function';

  return (
    <div
      className={`dash-card dash-card--${variant} ${clickable ? 'dash-card--clickable' : ''}`}
      onClick={clickable ? onClick : undefined}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={
        clickable
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
    >
      <div className="dash-card-icon">{icon}</div>
      <div className="dash-card-body">
        <p className="dash-card-title">{title}</p>
        {loading ? (
          <span className="dash-card-skeleton" />
        ) : (
          <p className="dash-card-count">{count}</p>
        )}
      </div>
      {clickable && !loading && <span className="dash-card-hint">View list →</span>}
    </div>
  );
}
