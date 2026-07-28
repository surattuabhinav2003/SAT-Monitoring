import './LoadingSpinner.css';

/**
 * Reusable loading indicator.
 * @param {string} [label]  Optional text shown beneath the spinner.
 * @param {boolean} [fullPage]  Center within the full viewport when true.
 */
export default function LoadingSpinner({ label = 'Loading…', fullPage = false }) {
  return (
    <div className={fullPage ? 'spinner-wrap spinner-wrap--full' : 'spinner-wrap'}>
      <div className="spinner" role="status" aria-live="polite" />
      {label && <p className="spinner-label">{label}</p>}
    </div>
  );
}
