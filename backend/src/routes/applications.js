import { Router } from 'express';
import { query } from '../db.js';
import { ApiError, asyncRoute } from '../errors.js';
import { requireAuth, requireAdmin, requireDiscoveryOperator } from '../auth.js';
import { requestRun, getDiscoveryState } from '../discovery/scheduler.js';
import { getRecentRuns } from '../discovery/sync.js';

const router = Router();

/**
 * Applications are DISCOVERED, not created by hand: Docker discovery owns
 * identity and liveness, admins own the business metadata.
 *
 * There is deliberately no POST (see the discovery service) and no DELETE
 * (inventory history is permanent).
 *
 * This process has NO Docker access. A manual scan is REQUESTED from the worker
 * over Postgres NOTIFY rather than executed here.
 */
router.use(requireAuth);

function toDto(row) {
  const pending = row.discovery_status === 'pending_review';
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    urlSource: row.url_source,
    team: row.team,
    developedBy: row.developed_by,
    status: row.status,
    decommissioned: row.decommissioned,
    gstackImplemented: row.gstack_implemented,
    notes: row.notes,
    source: row.source,
    discoveryStatus: row.discovery_status,
    dockerState: row.docker_state,
    healthStatus: row.health_status,
    firstSeen: row.first_seen,
    lastSeen: row.last_seen,
    approvedAt: row.approved_at,
    approvedBy: row.approved_by,
    pendingReview: pending,
    // No sat.url label and no nginx route — an admin must supply the hostname.
    needsMapping: !row.url,
    // Discovery says it is down and nobody has decided what that means.
    needsReview: row.status === 'Inactive' && !row.decommissioned && !pending,
    metadataComplete: Boolean(row.team && row.developed_by),
  };
}

const SELECT = `
  SELECT id, name, url, url_source, team, developed_by, status, decommissioned,
         gstack_implemented, notes, source, discovery_status, docker_state,
         health_status, first_seen, last_seen, approved_at, approved_by
  FROM applications
`;

function readId(raw) {
  const id = Number(raw);
  if (!Number.isInteger(id) || id < 1) throw new ApiError(400, 'Invalid application id.');
  return id;
}

/**
 * Read the ADMIN-OWNED fields from a request body.
 *
 * Server-owned fields (name, url, status, source, first_seen, last_seen,
 * discovery_status, docker_state, health_status) are ignored even if sent, so an
 * admin cannot overwrite what discovery owns.
 *
 * `url` is the one exception, handled separately below: an unmapped application
 * needs a human to supply the hostname discovery could not determine.
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
  if ('gstackImplemented' in body) out.gstackImplemented = Boolean(body.gstackImplemented);
  if ('decommissioned' in body) out.decommissioned = Boolean(body.decommissioned);
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

// GET /api/applications/discovery — scheduler state + recent runs
router.get(
  '/discovery',
  asyncRoute(async (_req, res) => {
    const runs = await getRecentRuns(10);
    res.json({ ...getDiscoveryState(), latestRun: runs[0] || null, runs });
  })
);

/**
 * POST /api/applications/discovery/run
 *
 * Requests a pass from the discovery worker. Returns 202: the work happens in
 * another process, so there is nothing to report synchronously — poll
 * GET /discovery for the outcome.
 */
router.post(
  '/discovery/run',
  requireDiscoveryOperator,
  asyncRoute(async (req, res) => {
    await requestRun(req.user.email);
    res.status(202).json({
      requested: true,
      message:
        'Discovery requested. The worker runs the scan; refresh in a few seconds to see the result.',
    });
  })
);

// GET /api/applications/:id/events — audit trail
router.get(
  '/:id/events',
  asyncRoute(async (req, res) => {
    const id = readId(req.params.id);
    const { rows } = await query(
      `SELECT id, event_type, old_value, new_value, actor, created_at
         FROM application_events WHERE application_id = $1
        ORDER BY created_at DESC, id DESC LIMIT 200`,
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
 * POST /api/applications/:id/approve (admin)
 *
 * Moves a newly discovered application out of pending_review. Discovery keeps it
 * pending until a human confirms it belongs in the inventory, so an unexpected
 * container never silently becomes a tracked application.
 */
router.post(
  '/:id/approve',
  requireAdmin,
  asyncRoute(async (req, res) => {
    const id = readId(req.params.id);

    const { rows: before } = await query(
      'SELECT discovery_status, status FROM applications WHERE id = $1',
      [id]
    );
    if (before.length === 0) throw new ApiError(404, 'Application not found.');
    if (before[0].discovery_status !== 'pending_review') {
      throw new ApiError(409, 'This application has already been reviewed.');
    }

    const { rows } = await query(
      `UPDATE applications
          SET discovery_status = CASE WHEN status = 'Inactive' THEN 'inactive' ELSE 'active' END,
              approved_at = now(), approved_by = $2, updated_at = now()
        WHERE id = $1
      RETURNING id, name, url, url_source, team, developed_by, status, decommissioned,
                gstack_implemented, notes, source, discovery_status, docker_state,
                health_status, first_seen, last_seen, approved_at, approved_by`,
      [id, req.user.email]
    );

    await query(
      `INSERT INTO application_events
         (application_id, event_type, old_value, new_value, actor)
       VALUES ($1, 'APPLICATION_APPROVED', 'pending_review', $2, $3)`,
      [id, rows[0].discovery_status, req.user.email]
    );

    res.json(toDto(rows[0]));
  })
);

/**
 * PUT /api/applications/:id/url (admin)
 *
 * Supply the hostname for an application discovery could not map. Kept separate
 * from the metadata route because `url` is normally server-owned — this is the
 * one deliberate hand-off, and it is audited.
 */
router.put(
  '/:id/url',
  requireAdmin,
  asyncRoute(async (req, res) => {
    const id = readId(req.params.id);
    const raw = String(req.body?.url ?? '').trim();
    if (!raw) throw new ApiError(400, 'A URL is required.');

    const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    try {
      new URL(url);
    } catch {
      throw new ApiError(400, 'Enter a valid hostname or http(s) URL.');
    }

    const { rows: before } = await query('SELECT url FROM applications WHERE id = $1', [id]);
    if (before.length === 0) throw new ApiError(404, 'Application not found.');

    const { rows } = await query(
      `UPDATE applications
          SET url = $2, url_source = 'manual', updated_at = now()
        WHERE id = $1
      RETURNING id, name, url, url_source, team, developed_by, status, decommissioned,
                gstack_implemented, notes, source, discovery_status, docker_state,
                health_status, first_seen, last_seen, approved_at, approved_by`,
      [id, url]
    );

    await query(
      `INSERT INTO application_events
         (application_id, event_type, old_value, new_value, actor)
       VALUES ($1, 'APPLICATION_URL_SET', $2, $3, $4)`,
      [id, before[0].url, url, req.user.email]
    );

    res.json(toDto(rows[0]));
  })
);

/**
 * PUT /api/applications/:id (admin) — ADMIN-OWNED fields only.
 */
router.put(
  '/:id',
  requireAdmin,
  asyncRoute(async (req, res) => {
    const id = readId(req.params.id);
    const fields = readAdminFields(req.body || {});

    const before = await query('SELECT decommissioned FROM applications WHERE id = $1', [id]);
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
      RETURNING id, name, url, url_source, team, developed_by, status, decommissioned,
                gstack_implemented, notes, source, discovery_status, docker_state,
                health_status, first_seen, last_seen, approved_at, approved_by`,
      params
    );

    // Decommissioning is a business decision — audit who made it.
    if ('decommissioned' in fields && fields.decommissioned !== before.rows[0].decommissioned) {
      await query(
        `INSERT INTO application_events
           (application_id, event_type, old_value, new_value, actor)
         VALUES ($1, 'APPLICATION_DECOMMISSIONED', $2, $3, $4)`,
        [id, String(before.rows[0].decommissioned), String(fields.decommissioned), req.user.email]
      );
    }

    res.json(toDto(rows[0]));
  })
);

export default router;
