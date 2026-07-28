import { Router } from 'express';
import { query } from '../db.js';
import { ApiError, asyncRoute } from '../errors.js';
import { requireAuth, requireAdmin } from '../auth.js';

const router = Router();

// Reading the inventory needs a signed-in user; changing it needs an admin.
// This mirrors the UI, where standard users are read-only.
router.use(requireAuth);

/** DB row (snake_case) -> API shape (camelCase) the SPA already expects. */
function toDto(row) {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    team: row.team,
    developedBy: row.developed_by,
    status: row.status,
    decommissioned: row.decommissioned,
    gstackImplemented: row.gstack_implemented,
  };
}

const SELECT = `
  SELECT id, name, url, team, developed_by, status, decommissioned,
         gstack_implemented
  FROM applications
`;

/**
 * Snap a free-text label to the spelling already used for it, matching
 * case-insensitively and ignoring repeated whitespace.
 *
 * Without this, "Migration" and "migration" are stored as two distinct values
 * and every grouping — the team pie chart especially — reports them as two
 * separate teams. First spelling wins, so later entries fall in line with it.
 */
async function canonicalise(column, value) {
  const { rows } = await query(
    `SELECT ${column} AS label
       FROM applications
      WHERE lower(${column}) = lower($1)
      ORDER BY id ASC
      LIMIT 1`,
    [value]
  );
  return rows.length > 0 ? rows[0].label : value;
}

/** Validate and normalise an incoming application payload. */
function readPayload(body) {
  const name = String(body?.name ?? '').trim();
  const url = String(body?.url ?? '').trim();
  // Collapse internal runs of whitespace so "Web  Team" matches "Web Team".
  const team = String(body?.team ?? '').trim().replace(/\s+/g, ' ');
  const developedBy = String(body?.developedBy ?? '').trim().replace(/\s+/g, ' ');
  const status = body?.status === 'Inactive' ? 'Inactive' : 'Active';

  if (!name) throw new ApiError(400, 'Application name is required.');
  if (!url) throw new ApiError(400, 'Application URL is required.');
  if (!/^https?:\/\/.+/i.test(url)) {
    throw new ApiError(400, 'Enter a valid http(s) URL.');
  }
  if (!team) throw new ApiError(400, 'Team is required.');
  if (!developedBy) throw new ApiError(400, 'Developed by is required.');

  return {
    name,
    url,
    team,
    developedBy,
    status,
    decommissioned: Boolean(body?.decommissioned),
    gstackImplemented: Boolean(body?.gstackImplemented),
  };
}

function readId(raw) {
  const id = Number(raw);
  if (!Number.isInteger(id) || id < 1) {
    throw new ApiError(400, 'Invalid application id.');
  }
  return id;
}

// GET /api/applications
router.get(
  '/',
  asyncRoute(async (_req, res) => {
    // lower(name), not name: the database collation sorts by byte value, which
    // puts every capitalised name before every lowercase one ("Zebra" before
    // "apple"). Case-insensitive ordering is what a reader expects.
    const { rows } = await query(`${SELECT} ORDER BY lower(name) ASC, id ASC`);
    res.json(rows.map(toDto));
  })
);

// POST /api/applications (admin)
router.post(
  '/',
  requireAdmin,
  asyncRoute(async (req, res) => {
    const app = readPayload(req.body);
    app.team = await canonicalise('team', app.team);
    app.developedBy = await canonicalise('developed_by', app.developedBy);
    try {
      const { rows } = await query(
        `INSERT INTO applications
           (name, url, team, developed_by, status, decommissioned, gstack_implemented)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, name, url, team, developed_by, status, decommissioned,
                   gstack_implemented`,
        [
          app.name,
          app.url,
          app.team,
          app.developedBy,
          app.status,
          app.decommissioned,
          app.gstackImplemented,
        ]
      );
      res.status(201).json(toDto(rows[0]));
    } catch (err) {
      // 23505 = unique_violation on applications_name_key
      if (err.code === '23505') {
        throw new ApiError(409, `An application named "${app.name}" already exists.`);
      }
      throw err;
    }
  })
);

// PUT /api/applications/:id (admin)
router.put(
  '/:id',
  requireAdmin,
  asyncRoute(async (req, res) => {
    const id = readId(req.params.id);
    const app = readPayload(req.body);
    app.team = await canonicalise('team', app.team);
    app.developedBy = await canonicalise('developed_by', app.developedBy);
    try {
      const { rows } = await query(
        `UPDATE applications
            SET name = $1, url = $2, team = $3, developed_by = $4, status = $5,
                decommissioned = $6, gstack_implemented = $7, updated_at = now()
          WHERE id = $8
        RETURNING id, name, url, team, developed_by, status, decommissioned,
                  gstack_implemented`,
        [
          app.name,
          app.url,
          app.team,
          app.developedBy,
          app.status,
          app.decommissioned,
          app.gstackImplemented,
          id,
        ]
      );
      if (rows.length === 0) throw new ApiError(404, 'Application not found.');
      res.json(toDto(rows[0]));
    } catch (err) {
      if (err.code === '23505') {
        throw new ApiError(409, `An application named "${app.name}" already exists.`);
      }
      throw err;
    }
  })
);

// DELETE /api/applications/:id (admin)
router.delete(
  '/:id',
  requireAdmin,
  asyncRoute(async (req, res) => {
    const id = readId(req.params.id);
    const { rowCount } = await query('DELETE FROM applications WHERE id = $1', [id]);
    if (rowCount === 0) throw new ApiError(404, 'Application not found.');
    res.json({ success: true });
  })
);

export default router;
