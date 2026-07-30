import { Router } from 'express';
import { query } from '../db.js';
import { ApiError, asyncRoute } from '../errors.js';
import { requireAuth, requireAdmin, requireDiscoveryOperator } from '../auth.js';
import { requestRun, getDiscoveryState } from '../discovery/scheduler.js';
import { getRecentRuns, latestRunId, waitForRunAfter } from '../discovery/sync.js';

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
  const state = row.decommission_state || 'none';
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    urlSource: row.url_source,
    team: row.team,
    developedBy: row.developed_by,
    status: row.status,
    decommissionState: state,
    // Retained for convenience: "is it fully retired". Read-only — writes go
    // through decommissionState.
    decommissioned: state === 'done',
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
    // Discovery says it is down and nobody has decided what that means. Flagging
    // it "needed" counts as a decision, so it leaves the queue.
    needsReview: row.status === 'Inactive' && state === 'none' && !pending,
    metadataComplete: Boolean(row.team && row.developed_by),
  };
}

const SELECT = `
  SELECT id, name, url, url_source, team, developed_by, status,
         decommission_state, gstack_implemented, notes, source, discovery_status,
         docker_state, health_status, first_seen, last_seen, approved_at, approved_by
  FROM applications
`;

function readId(raw) {
  const id = Number(raw);
  if (!Number.isInteger(id) || id < 1) throw new ApiError(400, 'Invalid application id.');
  return id;
}

/**
 * Decommission lifecycle. 'needed' is the middle step a boolean could not
 * express: flagged for retirement, not yet retired.
 */
const DECOMMISSION_STATES = ['none', 'needed', 'done'];

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

  if ('decommissionState' in body) {
    const v = String(body.decommissionState ?? '').trim().toLowerCase();
    if (!DECOMMISSION_STATES.includes(v)) {
      throw new ApiError(
        400,
        `Invalid decommission state. Expected one of: ${DECOMMISSION_STATES.join(', ')}.`
      );
    }
    out.decommissionState = v;
  } else if ('decommissioned' in body) {
    // Backwards compatible: a boolean maps onto the two end states. It cannot
    // express "needed", which is why decommissionState is the field to use.
    out.decommissionState = body.decommissioned ? 'done' : 'none';
  }

  if ('notes' in body) {
    const v = String(body.notes ?? '').trim();
    out.notes = v || null;
  }

  if (Object.keys(out).length === 0) {
    throw new ApiError(
      400,
      'Nothing to update. Editable fields: team, developedBy, gstackImplemented, decommissionState, notes.'
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

/** Separators people actually type between team names. */
const TEAM_SPLIT = /\s*(?:,|;|\/|\||\band\b)\s*/i;

/**
 * The company's teams. An application may be used by any combination of these
 * and nothing else, so the field is a closed set rather than free text.
 *
 * Configurable via TEAMS (comma-separated) so the list can change without a code
 * change. The canonical casing here is what gets stored, whatever case is sent.
 */
const ALLOWED_TEAMS = (
  process.env.TEAMS ||
  'Migration,QA,Infra,Manage,Engineer,AI,SAT,HR,Marketing,Sales'
)
  .split(',')
  .map((t) => t.trim().replace(/\s+/g, ' '))
  .filter(Boolean);

const TEAM_BY_KEY = new Map(ALLOWED_TEAMS.map((t) => [t.toLowerCase(), t]));

export { ALLOWED_TEAMS };

/**
 * Validate and normalise the team field, which may name SEVERAL teams.
 *
 * Stored as a comma-separated list in one column. Each name is checked
 * INDIVIDUALLY against ALLOWED_TEAMS — a whole-value match could never work once
 * a cell holds more than one team, and every name must be a real team.
 *
 * Unknown teams are REJECTED rather than stored: the set is closed, so accepting
 * a typo would quietly create a ninth team nobody can see in the picker.
 * Duplicates collapse case-insensitively, and casing is normalised to the list.
 *
 * Enforced here as well as in the UI, because the UI is only a convenience.
 */
function canonicaliseTeams(value) {
  const names = String(value ?? '')
    .split(TEAM_SPLIT)
    .map((t) => t.trim().replace(/\s+/g, ' '))
    .filter(Boolean);
  if (names.length === 0) return null;

  const seen = new Set();
  const out = [];
  const unknown = [];

  for (const name of names) {
    const key = name.toLowerCase();
    const canonical = TEAM_BY_KEY.get(key);
    if (!canonical) {
      unknown.push(name);
      continue;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(canonical);
  }

  if (unknown.length > 0) {
    throw new ApiError(
      400,
      `Unknown team${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')}. ` +
        `Allowed teams are ${ALLOWED_TEAMS.join(', ')}.`
    );
  }

  // Keep the stored order matching the configured order, so the same set of
  // teams always renders identically regardless of typing order.
  out.sort((a, b) => ALLOWED_TEAMS.indexOf(a) - ALLOWED_TEAMS.indexOf(b));
  return out.join(', ');
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

/**
 * GET /api/applications/teams
 *
 * The allowed teams, served from the same constant the API validates against, so
 * the picker and the validation can never disagree.
 */
router.get(
  '/teams',
  asyncRoute(async (_req, res) => {
    res.json({ teams: ALLOWED_TEAMS });
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
 * Runs a discovery pass and returns its result.
 *
 * The scan itself executes in the worker — this process has no Docker access by
 * design — but the caller should not have to poll to find out what happened. So
 * the request notifies the worker and then waits for that run to complete,
 * returning the real counts. Bounded wait: a worker that is down produces a clear
 * 504 rather than an open connection.
 */
router.post(
  '/discovery/run',
  requireDiscoveryOperator,
  asyncRoute(async (req, res) => {
    const before = await latestRunId();
    await requestRun(req.user.email);

    const run = await waitForRunAfter(before);
    if (!run) {
      throw new ApiError(
        504,
        'The discovery worker did not respond. Check that the sat-worker container is running.'
      );
    }
    if (run.errors) {
      throw new ApiError(503, `Discovery failed: ${run.errors}`);
    }
    res.json(run);
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
      RETURNING id, name, url, url_source, team, developed_by, status,
                decommission_state, gstack_implemented, notes, source,
                discovery_status, docker_state, health_status, first_seen,
                last_seen, approved_at, approved_by`,
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
      RETURNING id, name, url, url_source, team, developed_by, status,
                decommission_state, gstack_implemented, notes, source,
                discovery_status, docker_state, health_status, first_seen,
                last_seen, approved_at, approved_by`,
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

    const before = await query(
      'SELECT decommission_state FROM applications WHERE id = $1',
      [id]
    );
    if (before.rows.length === 0) throw new ApiError(404, 'Application not found.');

    // Teams are a validated list; developed_by is a single free-text owner.
    if ('team' in fields) fields.team = canonicaliseTeams(fields.team);
    if ('developedBy' in fields) {
      fields.developedBy = await canonicalise('developed_by', fields.developedBy);
    }

    const columnFor = {
      team: 'team',
      developedBy: 'developed_by',
      gstackImplemented: 'gstack_implemented',
      decommissionState: 'decommission_state',
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
      RETURNING id, name, url, url_source, team, developed_by, status,
                decommission_state, gstack_implemented, notes, source,
                discovery_status, docker_state, health_status, first_seen,
                last_seen, approved_at, approved_by`,
      params
    );

    // Decommissioning is a business decision — audit who made it.
    if (
      'decommissionState' in fields &&
      fields.decommissionState !== before.rows[0].decommission_state
    ) {
      await query(
        `INSERT INTO application_events
           (application_id, event_type, old_value, new_value, actor)
         VALUES ($1, 'APPLICATION_DECOMMISSION_CHANGED', $2, $3, $4)`,
        [
          id,
          before.rows[0].decommission_state,
          fields.decommissionState,
          req.user.email,
        ]
      );
    }

    res.json(toDto(rows[0]));
  })
);

export default router;
