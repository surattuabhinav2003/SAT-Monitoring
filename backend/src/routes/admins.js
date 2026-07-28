import { Router } from 'express';
import { query } from '../db.js';
import { ApiError, asyncRoute } from '../errors.js';
import { requireAdmin } from '../auth.js';

const router = Router();

// Managing who holds admin access is itself an admin-only capability.
router.use(requireAdmin);

/**
 * Domain allow-list for who may be granted admin access.
 *
 * Intentionally EMPTY — any well-formed address is accepted, per the current
 * requirement. To restrict later, set ADMIN_ALLOWED_DOMAINS in the environment
 * (comma-separated, e.g. "cloudfuze.com") and no code needs to change.
 *
 * Note this is enforced server-side as well as in the UI; the frontend check
 * alone would be bypassable.
 */
const ALLOWED_DOMAINS = (process.env.ADMIN_ALLOWED_DOMAINS || '')
  .split(',')
  .map((d) => d.trim().toLowerCase())
  .filter(Boolean);

function toDto(row) {
  return {
    id: row.id,
    email: row.email,
    addedBy: row.added_by,
    addedAt: row.added_at,
  };
}

function readEmail(body) {
  const email = String(body?.email ?? '').trim().toLowerCase();

  if (!email) throw new ApiError(400, 'Enter an email address.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    throw new ApiError(400, 'Enter a valid email address.');
  }
  if (ALLOWED_DOMAINS.length > 0) {
    const domain = email.split('@')[1];
    if (!ALLOWED_DOMAINS.includes(domain)) {
      throw new ApiError(
        400,
        `Only these domains can be granted access: ${ALLOWED_DOMAINS.join(', ')}.`
      );
    }
  }
  return email;
}

// GET /api/admins
router.get(
  '/',
  asyncRoute(async (_req, res) => {
    const { rows } = await query(
      'SELECT id, email, added_by, added_at FROM admins ORDER BY added_at ASC'
    );
    res.json(rows.map(toDto));
  })
);

// POST /api/admins
router.post(
  '/',
  asyncRoute(async (req, res) => {
    const email = readEmail(req.body);
    // Attribution comes from the verified token, never from the request body —
    // otherwise a caller could forge who granted the access.
    const addedBy = req.user.email;

    const { rows } = await query(
      `INSERT INTO admins (email, added_by)
       VALUES ($1, $2)
       ON CONFLICT (email) DO NOTHING
       RETURNING id, email, added_by, added_at`,
      [email, addedBy]
    );

    if (rows.length === 0) {
      throw new ApiError(409, 'That address already has admin access.');
    }
    res.status(201).json(toDto(rows[0]));
  })
);

// DELETE /api/admins/:id
router.delete(
  '/:id',
  asyncRoute(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      throw new ApiError(400, 'Invalid admin id.');
    }

    // Never allow the list to be emptied — nobody could grant access again.
    const { rows: countRows } = await query('SELECT COUNT(*)::int AS n FROM admins');
    if (countRows[0].n <= 1) {
      throw new ApiError(
        409,
        'Cannot remove the last admin — grant access to someone else first.'
      );
    }

    // Enforce the no-self-revoke rule here too, not just in the UI, so an admin
    // cannot lock themselves out by calling the API directly.
    const { rows: target } = await query('SELECT email FROM admins WHERE id = $1', [id]);
    if (target.length === 0) throw new ApiError(404, 'Admin not found.');
    if (target[0].email === req.user.email) {
      throw new ApiError(409, 'You cannot remove your own admin access.');
    }

    const { rowCount } = await query('DELETE FROM admins WHERE id = $1', [id]);
    if (rowCount === 0) throw new ApiError(404, 'Admin not found.');
    res.json({ success: true });
  })
);

export default router;
