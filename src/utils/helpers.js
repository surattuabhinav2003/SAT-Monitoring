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
 * Effective lifecycle state of an application, collapsing the two flags that
 * discovery and admins each own into the single label a reader cares about.
 *
 * Decommissioned wins: once an admin has made that call it is the answer,
 * regardless of whether a container happens to be running.
 */
export function lifecycleOf(app) {
  if (app?.decommissioned) return 'Decommissioned';
  return app?.status === 'Active' ? 'Active' : 'Inactive';
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
