import './StatTile.css';

/**
 * Compact KPI tile: the number is the hero, the label supports it.
 *
 * Deliberately compact and fixed-proportion. The previous cards stretched to
 * whatever width the grid gave them, so on a wide monitor a two-line block sat
 * in 500px of empty space — the main reason the dashboard read as unfinished.
 *
 * @param {string} label
 * @param {number} value
 * @param {'neutral'|'success'|'warning'|'danger'|'accent'|'muted'} tone
 *   Colour is semantic ONLY where it carries meaning. A count of zero is not a
 *   problem, so a zero renders muted regardless of tone.
 * @param {ReactNode} icon
 * @param {string} [hint]  Small line under the number.
 * @param {Function} [onClick]  Makes the tile an interactive button.
 */
export default function StatTile({
  label,
  value,
  tone = 'neutral',
  icon,
  hint,
  loading = false,
  onClick,
}) {
  const clickable = typeof onClick === 'function';
  // A zero count never signals alarm — grey it out rather than colouring it red.
  const effectiveTone = value === 0 && !loading ? 'muted' : tone;

  const Element = clickable ? 'button' : 'div';

  return (
    <Element
      type={clickable ? 'button' : undefined}
      className={`stat-tile stat-tile--${effectiveTone} ${clickable ? 'is-clickable' : ''}`}
      onClick={onClick}
      aria-label={clickable ? `${label}: ${value}` : undefined}
    >
      <span className="stat-tile-top">
        {icon && <span className="stat-tile-icon">{icon}</span>}
        <span className="stat-tile-label">{label}</span>
      </span>

      {loading ? (
        <span className="stat-tile-skeleton" />
      ) : (
        <strong className="stat-tile-value">{value}</strong>
      )}

      {hint && !loading && <span className="stat-tile-hint">{hint}</span>}
      {clickable && <span className="stat-tile-chev" aria-hidden="true">→</span>}
    </Element>
  );
}
