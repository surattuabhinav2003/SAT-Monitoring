import { Router } from 'express';
import { query } from '../db.js';
import { ApiError, asyncRoute } from '../errors.js';
import { requireAuth, requireAdmin } from '../auth.js';
import { runOnce, getDiscoveryState } from '../discovery/scheduler.js';

const router = Router();

/**
 * Applications are DISCOVERED, not created by hand: Docker discovery owns
 * identity and liveness, and admins own the business metadata.
 *
 * There is deliberately no POST route — see the discovery service. Admins edit
 * only the fields they own, and nothing here can delete an application:
 * inventory history is permanent.
 */
router.use(requireAuth);

/** DB row (snake_case) -> API shape (camelCase) the SPA expects. */
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
    notes: row.notes,
    source: row.source,
    discoveryStatus: row.discovery_status,
    firstSeen: row.first_seen,
    lastSeen: row.last_seen,
    // True when discovery has stopped seeing it but no admin has decided yet.
    needsReview: row.status === 'Inactive' && !row.decommissioned,
    // Business metadata an admin still has to supply.
    metadataComplete: Boolean(row.team && row.developed_by),
  };
}

const SELECT = `
  SELECT id, name, url, team, developed_by, status, decommissioned,
         gstack_implemented, notes, source, discovery_status, first_seen, last_seen
  FROM applications
`;

function readId(raw) {
  const id = Number(raw);
  if (!Number.isInteger(id) || id < 1) {
    throw new ApiError(400, 'Invalid application id.');
  }
  return id;
}

/**
 * Read the ADMIN-OWNED fields from a request body.
 *
 * Server-owned fields (name, url, status, source, first_seen, last_seen,
 * discovery_status) are intentionally ignored even if sent, so an admin cannot
 * overwrite what discovery owns.
 */
function readAdminFields(body) {
  const out = {};

  if ('team' in body) {
    const v = String(body.team ?? '').trim().replace(/\s+/g, ' ');
    out.team = v || null;
  }
  if ('developedBy' in body) {
    const v = String(body.developedBy ?? '').trim().replace(/\s+/g, ' ');
    out.developedBy = v || null;
  }
  if ('gstackImplemented' in body) {
    out.gstackImplemented = Boolean(body.gstackImplemented);
  }
  if ('decommissioned' in body) {
    out.decommissioned = Boolean(body.decommissioned);
  }
  if ('notes' in body) {
    const v = String(body.notes ?? '').trim();
    out.notes = v || null;
  }

  if (Object.keys(out).length === 0) {
    throw new ApiError(
      400,
      'Nothing to update. Editable fields: team, developedBy, gstackImplemented, decommissioned, notes.'
    );
  }
  return out;
}

/** Snap a label to the spelling already in use (case-insensitive). */
async function canonicalise(column, value) {
  if (!value) return value;
  const { rows } = await query(
    `SELECT ${column} AS label FROM applications
      WHERE lower(${column}) = lower($1) ORDER BY id ASC LIMIT 1`,
    [value]
  );
  return rows.length > 0 ? rows[0].label : value;
}

// GET /api/applications
router.get(
  '/',
  asyncRoute(async (_req, res) => {
    // lower(name): the database collation sorts by byte value, which would put
    // every capitalised name before every lowercase one.
    const { rows } = await query(`${SELECT} ORDER BY lower(name) ASC, id ASC`);
    res.json(rows.map(toDto));
  })
);

// GET /api/applications/discovery — status of the discovery loop
router.get(
  '/discovery',
  asyncRoute(async (_req, res) => {
    res.json(getDiscoveryState());
  })
);

// POST /api/applications/discovery/run — trigger a pass now (admin)
router.post(
  '/discovery/run',
  requireAdmin,
  asyncRoute(async (_req, res) => {
    let stats;
    try {
      stats = await runOnce('api');
    } catch (err) {
      // Surface the real reason — almost always an unreachable Docker socket —
      // rather than a generic failure the operator cannot act on.
      throw new ApiError(503, `Discovery failed: ${err.message}`);
    }
    // null means a pass was already in flight, which is a different situation.
    if (!stats) {
      throw new ApiError(409, 'A discovery pass is already running. Try again shortly.');
    }
    res.json(stats);
  })
);

// GET /api/applications/:id/events — audit trail
router.get(
  '/:id/events',
  asyncRoute(async (req, res) => {
    const id = readId(req.params.id);
    const { rows } = await query(
      `SELECT id, event_type, old_value, new_value, actor, created_at
         FROM application_events
        WHERE application_id = $1
        ORDER BY created_at DESC, id DESC
        LIMIT 200`,
      [id]
    );
    res.json(
      rows.map((r) => ({
        id: r.id,
        eventType: r.event_type,
        oldValue: r.old_value,
        newValue: r.new_value,
        actor: r.actor,
        createdAt: r.created_at,
      }))
    );
  })
);

/**
 * PUT /api/applications/:id (admin)
 *
 * Updates ADMIN-OWNED fields only. Server-owned fields in the body are ignored.
 */
router.put(
  '/:id',
  requireAdmin,
  asyncRoute(async (req, res) => {
    const id = readId(req.params.id);
    const fields = readAdminFields(req.body || {});

    const before = await query(
      'SELECT decommissioned FROM applications WHERE id = $1',
      [id]
    );
    if (before.rows.length === 0) throw new ApiError(404, 'Application not found.');

    if ('team' in fields) fields.team = await canonicalise('team', fields.team);
    if ('developedBy' in fields) {
      fields.developedBy = await canonicalise('developed_by', fields.developedBy);
    }

    const columnFor = {
      team: 'team',
      developedBy: 'developed_by',
      gstackImplemented: 'gstack_implemented',
      decommissioned: 'decommissioned',
      notes: 'notes',
    };

    const sets = [];
    const params = [];
    for (const [key, value] of Object.entries(fields)) {
      params.push(value);
      sets.push(`${columnFor[key]} = $${params.length}`);
    }
    params.push(id);

    const { rows } = await query(
      `UPDATE applications SET ${sets.join(', ')}, updated_at = now()
        WHERE id = $${params.length}
      RETURNING id, name, url, team, developed_by, status, decommissioned,
                gstack_implemented, notes, source, discovery_status,
                first_seen, last_seen`,
      params
    );

    // Decommissioning is a business decision — audit who made it.
    if (
      'decommissioned' in fields &&
      fields.decommissioned !== before.rows[0].decommissioned
    ) {
      await query(
        `INSERT INTO application_events
           (application_id, event_type, old_value, new_value, actor)
         VALUES ($1, 'APPLICATION_DECOMMISSIONED', $2, $3, $4)`,
        [
          id,
          String(before.rows[0].decommissioned),
          String(fields.decommissioned),
          req.user.email,
        ]
      );
    }

    res.json(toDto(rows[0]));
  })
);

export default router;
