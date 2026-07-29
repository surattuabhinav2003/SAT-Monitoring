import './TeamBars.css';

/**
 * Team usage as a ranked horizontal bar list.
 *
 * Replaces the donut chart. A donut fails exactly where this data usually sits:
 * with one team it renders a single 100% ring that conveys nothing, and with
 * many teams the slices become unreadable and need leader lines. A ranked bar
 * list is legible from one row to twenty, sorts by what matters, and labels
 * every value directly.
 *
 * @param {Array<{team:string, count:number}>} data
 */

// CloudFuze brand blues, darkest first so the leading team reads strongest.
const COLORS = ['#0129ac', '#0c18d4', '#0065ff', '#3fd6f1', '#14cfc3', '#809efc', '#a7daff'];

export default function TeamBars({ data, onSelect }) {
  const rows = [...data].sort((a, b) => b.count - a.count);
  const total = rows.reduce((sum, r) => sum + r.count, 0);
  const max = rows.length > 0 ? rows[0].count : 0;

  return (
    <section className="panel">
      <header className="panel-head">
        <div>
          <h3 className="panel-title">Team-wise Application Usage</h3>
          <p className="panel-sub">Applications grouped by the team using them</p>
        </div>
        <span className="panel-total">
          {rows.length}
          <small>{rows.length === 1 ? 'team' : 'teams'}</small>
        </span>
      </header>

      {rows.length === 0 ? (
        <p className="panel-empty">
          No teams recorded yet — set “Team Using” on an application.
        </p>
      ) : (
        <ul className="team-list">
          {rows.map((row, i) => {
            const pct = total > 0 ? (row.count / total) * 100 : 0;
            // Bar length is relative to the LARGEST team, not the total, so a
            // single team fills the row instead of rendering a 100% slab.
            const width = max > 0 ? (row.count / max) * 100 : 0;
            const clickable = typeof onSelect === 'function';
            const Row = clickable ? 'button' : 'div';

            return (
              <li key={row.team}>
                <Row
                  type={clickable ? 'button' : undefined}
                  className={`team-row ${clickable ? 'is-clickable' : ''}`}
                  onClick={clickable ? () => onSelect(row.team) : undefined}
                >
                  <span className="team-rank">{i + 1}</span>
                  <span className="team-name" title={row.team}>
                    {row.team}
                  </span>
                  <span className="team-track">
                    <span
                      className="team-fill"
                      style={{
                        width: `${width}%`,
                        background: COLORS[i % COLORS.length],
                      }}
                    />
                  </span>
                  <span className="team-count">{row.count}</span>
                  <span className="team-pct">{Math.round(pct)}%</span>
                </Row>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
