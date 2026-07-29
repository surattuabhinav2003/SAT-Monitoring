/**
 * Small shared utility helpers.
 */

// Basic URL validation used by the application form.
export function isValidUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

// Return a shortened, human-friendly host for a URL (fallback to the raw value).
export function prettyUrl(value) {
  try {
    return new URL(value).host;
  } catch {
    return value;
  }
}

/**
 * The LIVE state discovery observed, ignoring the admin's decommission decision.
 *
 * Kept separate from `lifecycleOf` because the two answer different questions,
 * and the difference is informative: an application that is Decommissioned but
 * still Active means the container is running when it should not be — a cleanup
 * task that collapsing the two into one label would hide.
 *
 * Pending Review still takes precedence: until a human has confirmed the record
 * belongs in the inventory, its liveness is not yet meaningful.
 */
export function liveStateOf(app) {
  if (app?.discoveryStatus === 'pending_review') return 'Pending Review';
  if (app?.status === 'Warning') return 'Warning';
  return app?.status === 'Active' ? 'Active' : 'Inactive';
}

/**
 * Effective lifecycle state, collapsing every flag into the single label a
 * reader wants when only one can be shown — dashboard tiles, drill-downs,
 * filters.
 *
 * Decommissioned wins here: once an admin has made that call it is the answer.
 */
export function lifecycleOf(app) {
  if (app?.decommissioned) return 'Decommissioned';
  return liveStateOf(app);
}

/** Badge class for a lifecycle label. */
export function badgeClassFor(state) {
  switch (state) {
    case 'Active':
      return 'badge--active';
    case 'Warning':
      return 'badge--warning';
    case 'Decommissioned':
      return 'badge--decomm';
    case 'Pending Review':
      return 'badge--pending';
    default:
      return 'badge--inactive';
  }
}

// Format an ISO timestamp as a short, readable date (e.g. "28 Jul 2026").
export function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

// Generic comparator that supports strings, numbers and booleans.
export function compareValues(a, b, direction = 'asc') {
  const dir = direction === 'asc' ? 1 : -1;
  if (a == null) return 1;
  if (b == null) return -1;
  if (typeof a === 'string') {
    return a.localeCompare(b) * dir;
  }
  if (a < b) return -1 * dir;
  if (a > b) return 1 * dir;
  return 0;
}

// Build the list of page numbers to render for pagination.
export function getPageNumbers(current, total) {
  const pages = [];
  for (let i = 1; i <= total; i += 1) pages.push(i);
  return pages;
}
