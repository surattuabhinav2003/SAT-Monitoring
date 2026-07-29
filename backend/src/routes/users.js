import { Router } from 'express';
import { asyncRoute } from '../errors.js';
import { requireAuth, isAdminEmail, canRunDiscovery } from '../auth.js';

const router = Router();

/**
 * GET /api/users/me
 *
 * Resolve the CALLER's identity and role. The email comes from the verified
 * token, not from a query parameter — otherwise anyone could enumerate which
 * addresses hold admin access.
 *
 * The `admins` table is the single source of truth for the role.
 */
router.get(
  '/me',
  requireAuth,
  asyncRoute(async (req, res) => {
    const admin = await isAdminEmail(req.user.email);
    res.json({
      email: req.user.email,
      name: req.user.name,
      role: admin ? 'Admin' : 'User',
      // Per-action permission, so the UI can hide controls the caller cannot
      // use rather than letting them fail with a 403.
      canRunDiscovery: await canRunDiscovery(req.user.email),
    });
  })
);

export default router;
