import './ProportionBar.css';

/**
 * A single stacked bar plus a direct-labelled legend.
 *
 * Chosen over a bar chart on purpose: with two or three categories a plotted
 * chart is ~90% empty grid, axes and gridlines that carry no information. One
 * proportion bar shows the same split, reads instantly, and never looks unfinished
 * regardless of how few categories there are.
 *
 * @param {string} title
 * @param {string} [subtitle]
 * @param {Array<{label:string, value:number, color:string, onClick?:Function}>} segments
 * @param {string} [emptyLabel]
 */
export default function ProportionBar({ title, subtitle, segments, emptyLabel }) {
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  const visible = segments.filter((s) => s.value > 0);

  return (
    <section className="panel">
      <header className="panel-head">
        <div>
          <h3 className="panel-title">{title}</h3>
          {subtitle && <p className="panel-sub">{subtitle}</p>}
        </div>
        <span className="panel-total">
          {total}
          <small>total</small>
        </span>
      </header>

      {total === 0 ? (
        <p className="panel-empty">{emptyLabel || 'Nothing to show yet.'}</p>
      ) : (
        <>
          <div
            className="prop-track"
            role="img"
            aria-label={visible
              .map((s) => `${s.label}: ${s.value}`)
              .join(', ')}
          >
            {visible.map((s) => (
              <span
                key={s.label}
                className="prop-seg"
                style={{
                  // Percentage widths keep the bar exact at any container size.
                  width: `${(s.value / total) * 100}%`,
                  background: s.color,
                }}
                title={`${s.label}: ${s.value} (${Math.round((s.value / total) * 100)}%)`}
              />
            ))}
          </div>

          <ul className="prop-legend">
            {segments.map((s) => {
              const pct = total > 0 ? Math.round((s.value / total) * 100) : 0;
              const clickable = typeof s.onClick === 'function' && s.value > 0;
              const Row = clickable ? 'button' : 'div';
              return (
                <li key={s.label}>
                  <Row
                    type={clickable ? 'button' : undefined}
                    className={`prop-row ${clickable ? 'is-clickable' : ''} ${
                      s.value === 0 ? 'is-zero' : ''
                    }`}
                    onClick={clickable ? s.onClick : undefined}
                  >
                    <span className="prop-dot" style={{ background: s.color }} />
                    <span className="prop-label">{s.label}</span>
                    <span className="prop-value">{s.value}</span>
                    <span className="prop-pct">{pct}%</span>
                  </Row>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
