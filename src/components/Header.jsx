import './Header.css';

/**
 * Mobile-only top bar: opens the navigation drawer and names the app.
 *
 * On desktop the sidebar is always on screen and carries the brand, the
 * collapse toggle and the account block — so this bar is hidden there rather
 * than repeating any of it.
 */
export default function Header({ onToggleMobile }) {
  return (
    <header className="header">
      <button
        className="icon-btn"
        onClick={onToggleMobile}
        aria-label="Open navigation"
      >
        <MenuIcon />
      </button>
      <span className="header-title">SAT Monitoring</span>
    </header>
  );
}

/* --- Inline icons --- */
function MenuIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 6h18M3 12h18M3 18h18" />
    </svg>
  );
}
