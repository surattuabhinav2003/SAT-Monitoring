import { Router } from 'express';
import { query } from '../db.js';
import { ApiError, asyncRoute } from '../errors.js';
import { requireAuth, requireAdmin } from '../auth.js';

const router = Router();

router.use(requireAuth);

const TYPES = ['TOOL_DISCOVERED', 'TOOL_STOPPED', 'TOOL_RESTORED'];

function toDto(row) {
  return {
    id: row.id,
    applicationId: row.application_id,
    applicationName: row.application_name,
    type: row.type,
    message: row.message,
    isRead: row.is_read,
    createdAt: row.created_at,
  };
}

const SELECT = `
  SELECT n.id, n.application_id, n.type, n.message, n.is_read, n.created_at,
         a.name AS application_name
    FROM notifications n
    JOIN applications a ON a.id = n.application_id
`;

// GET /api/notifications?type=&unread=true&limit=
router.get(
  '/',
  asyncRoute(async (req, res) => {
    const filters = [];
    const params = [];

    if (req.query.type) {
      const type = String(req.query.type).toUpperCase();
      if (!TYPES.includes(type)) throw new ApiError(400, 'Unknown notification type.');
      params.push(type);
      filters.push(`n.type = $${params.length}`);
    }
    if (String(req.query.unread).toLowerCase() === 'true') {
      filters.push('n.is_read = FALSE');
    }

    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
    params.push(limit);

    const where = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';
    const { rows } = await query(
      `${SELECT} ${where} ORDER BY n.created_at DESC LIMIT $${params.length}`,
      params
    );
    res.json(rows.map(toDto));
  })
);

// GET /api/notifications/unread-count
router.get(
  '/unread-count',
  asyncRoute(async (_req, res) => {
    const { rows } = await query(
      'SELECT count(*)::int AS count FROM notifications WHERE is_read = FALSE'
    );
    res.json({ count: rows[0].count });
  })
);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// PUT /api/notifications/:id/read  (admin — acknowledging is an admin action)
router.put(
  '/:id/read',
  requireAdmin,
  asyncRoute(async (req, res) => {
    // Checked here so a malformed id is a 400 rather than a Postgres cast error.
    if (!UUID_RE.test(String(req.params.id))) {
      throw new ApiError(400, 'Invalid notification id.');
    }
    const { rows } = await query(
      `UPDATE notifications SET is_read = TRUE WHERE id = $1
       RETURNING id, application_id, type, message, is_read, created_at`,
      [req.params.id]
    );
    if (rows.length === 0) throw new ApiError(404, 'Notification not found.');
    res.json(toDto(rows[0]));
  })
);

// PUT /api/notifications/read-all
router.put(
  '/read-all',
  requireAdmin,
  asyncRoute(async (_req, res) => {
    const { rowCount } = await query(
      'UPDATE notifications SET is_read = TRUE WHERE is_read = FALSE'
    );
    res.json({ updated: rowCount });
  })
);

export default router;
