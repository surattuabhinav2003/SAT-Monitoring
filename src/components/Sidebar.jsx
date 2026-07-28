import { useState, useRef, useEffect } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import './Sidebar.css';

// Inline SVG icons keep the app dependency-free and crisp at any size.
const icons = {
  dashboard: (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="7" height="9" rx="1" />
      <rect x="14" y="3" width="7" height="5" rx="1" />
      <rect x="14" y="12" width="7" height="9" rx="1" />
      <rect x="3" y="16" width="7" height="5" rx="1" />
    </svg>
  ),
  applications: (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 9h18" />
      <path d="M8 4v5" />
    </svg>
  ),
  adminAccess: (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 3l7 3v5c0 4.2-2.8 7.6-7 9-4.2-1.4-7-4.8-7-9V6l7-3z" />
      <path d="M9.5 12.2l1.8 1.8 3.4-3.6" />
    </svg>
  ),
};

// `adminOnly` items are hidden from standard users. The matching route is also
// guarded, so hiding the link is presentation only, not the access control.
const NAV_ITEMS = [
  { to: '/dashboard', label: 'Dashboard', icon: icons.dashboard },
  { to: '/applications', label: 'Applications', icon: icons.applications },
  {
    to: '/admin-access',
    label: 'Admin Access',
    icon: icons.adminAccess,
    adminOnly: true,
  },
];

/** Matches the 768px breakpoint where the sidebar becomes a full-width drawer. */
function useIsMobile() {
  const [isMobile, setIsMobile] = useState(
    () => window.matchMedia('(max-width: 768px)').matches
  );

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)');
    const onChange = (e) => setIsMobile(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  return isMobile;
}

/**
 * Collapsible left navigation, styled after Microsoft Admin Center.
 *
 * The brand row doubles as the collapse control, and the signed-in user's
 * account sits in the footer with a menu carrying their email and sign-out.
 *
 * @param {boolean} collapsed  Whether the rail is in its narrow state.
 * @param {boolean} mobileOpen  Whether the drawer is open on small screens.
 * @param {Function} onCloseMobile  Close the mobile drawer.
 * @param {Function} onToggleCollapse  Toggle the narrow rail.
 */
export default function Sidebar({
  collapsed,
  mobileOpen,
  onCloseMobile,
  onToggleCollapse,
}) {
  const { user, role, isAdmin, logout } = useAuth();
  const isMobile = useIsMobile();

  // The mobile drawer is always full width, so the narrow-rail layout must not
  // apply there even if the desktop state is still "collapsed".
  const isRailCollapsed = collapsed && !isMobile;
  const navItems = NAV_ITEMS.filter((item) => !item.adminOnly || isAdmin);

  const [menuOpen, setMenuOpen] = useState(false);
  const accountRef = useRef(null);

  // Close the account menu on an outside click or Escape.
  useEffect(() => {
    if (!menuOpen) return;

    function handleClick(e) {
      if (accountRef.current && !accountRef.current.contains(e.target)) {
        setMenuOpen(false);
      }
    }
    function handleKey(e) {
      if (e.key === 'Escape') setMenuOpen(false);
    }

    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [menuOpen]);

  // Collapsing moves the menu from above the trigger to a flyout beside the
  // rail, so close it rather than let it jump position mid-interaction.
  useEffect(() => {
    setMenuOpen(false);
  }, [collapsed]);

  const initials = (user?.name || 'U')
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <>
      <div
        className={`sidebar-overlay ${mobileOpen ? 'is-visible' : ''}`}
        onClick={onCloseMobile}
        aria-hidden="true"
      />
      <aside
        className={`sidebar ${isRailCollapsed ? 'sidebar--collapsed' : ''} ${
          mobileOpen ? 'sidebar--mobile-open' : ''
        }`}
      >
        {/* Brand row doubles as the collapse control: expanded shows the name
            plus a chevron; collapsed shows only the SAT mark, which is itself
            the button that expands the rail again. */}
        <div className="sidebar-brand">
          {isRailCollapsed ? (
            <button
              className="brand-logo-btn"
              onClick={onToggleCollapse}
              aria-label="Expand sidebar"
              title="Expand"
            >
              <span className="sidebar-logo">SAT</span>
            </button>
          ) : (
            <>
              <span className="sidebar-brand-text">SAT Monitoring</span>
              <button
                className="brand-toggle"
                onClick={onToggleCollapse}
                aria-label="Collapse sidebar"
                title="Collapse"
              >
                <ChevronLeftIcon />
              </button>
            </>
          )}
        </div>

        <nav className="sidebar-nav">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `sidebar-link ${isActive ? 'sidebar-link--active' : ''}`
              }
              onClick={onCloseMobile}
              title={isRailCollapsed ? item.label : undefined}
            >
              <span className="sidebar-link-icon">{item.icon}</span>
              {!isRailCollapsed && (
                <span className="sidebar-link-label">{item.label}</span>
              )}
            </NavLink>
          ))}
        </nav>

        {/* --- Account --- */}
        <div className="sidebar-account" ref={accountRef}>
          {menuOpen && (
            <div className="account-menu" role="menu">
              <div className="account-menu-head">
                <span className="account-avatar account-avatar--lg">{initials}</span>
                <div className="account-menu-id">
                  <p className="account-name">{user?.name}</p>
                  <p className="account-email">{user?.email}</p>
                </div>
              </div>
              <button className="account-menu-item" onClick={logout} role="menuitem">
                <LogoutIcon />
                Sign out
              </button>
            </div>
          )}

          <button
            className={`account-trigger ${menuOpen ? 'is-open' : ''}`}
            onClick={() => setMenuOpen((o) => !o)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            title={isRailCollapsed ? `${user?.name} (${role})` : undefined}
          >
            <span className="account-avatar">{initials}</span>
            {!isRailCollapsed && (
              <>
                <span className="account-meta">
                  <span className="account-name">{user?.name}</span>
                  <span className={`account-role account-role--${role?.toLowerCase()}`}>
                    {role}
                  </span>
                </span>
                <ChevronIcon />
              </>
            )}
          </button>
        </div>
      </aside>
    </>
  );
}

/* --- Inline icons --- */
function LogoutIcon() {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="M16 17l5-5-5-5M21 12H9" />
    </svg>
  );
}

function ChevronLeftIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <path d="M15 18l-6-6 6-6" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg
      className="account-chevron"
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}
