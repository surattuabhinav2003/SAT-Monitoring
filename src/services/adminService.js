import api from './api.js';

/**
 * Admin-access service — who holds the Admin role. Backed by the `admins`
 * table in PostgreSQL via the REST API.
 *
 *   GET    /admins
 *   POST   /admins          { email, addedBy }
 *   DELETE /admins/:id
 *
 * The validation below is for immediate UI feedback only. The same rules are
 * enforced server-side (see backend/src/routes/admins.js) — a client-side check
 * alone would be bypassable.
 */

/**
 * Domain allow-list mirrored for client-side messaging.
 *
 * Intentionally EMPTY — any well-formed address is accepted, per the current
 * requirement. When the permitted domains are confirmed, set
 * ADMIN_ALLOWED_DOMAINS in the backend `.env` (that is the authoritative
 * setting) and list them here too so the UI can explain the rule up front.
 */
export const ALLOWED_DOMAINS = [];

export function normalizeEmail(email) {
  return (email || '').trim().toLowerCase();
}

/** Basic shape check — one @, a dotted domain, no whitespace. */
export function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(normalizeEmail(email));
}

/**
 * Validate a candidate address. Returns null when acceptable, otherwise a
 * message explaining why it was rejected.
 */
export function validateAdminEmail(email, existing = []) {
  const value = normalizeEmail(email);

  if (!value) return 'Enter an email address.';
  if (!isValidEmail(value)) return 'Enter a valid email address.';

  if (ALLOWED_DOMAINS.length > 0) {
    const domain = value.split('@')[1];
    if (!ALLOWED_DOMAINS.includes(domain)) {
      return `Only these domains can be granted access: ${ALLOWED_DOMAINS.join(', ')}.`;
    }
  }

  if (existing.some((a) => normalizeEmail(a.email) === value)) {
    return 'That address already has admin access.';
  }

  return null;
}

export async function getAdmins() {
  const { data } = await api.get('/admins');
  return data;
}

/**
 * Grant admin access. Attribution ("added by") is taken from the caller's
 * verified token server-side, so it is deliberately not sent from here.
 */
export async function addAdmin(email) {
  const { data } = await api.post('/admins', { email: normalizeEmail(email) });
  return data;
}

export async function removeAdmin(id) {
  await api.delete(`/admins/${id}`);
  return { success: true };
}
