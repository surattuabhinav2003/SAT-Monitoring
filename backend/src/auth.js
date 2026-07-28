import { createRemoteJWKSet, jwtVerify } from 'jose';
import { query } from './db.js';
import { ApiError, asyncRoute } from './errors.js';

/**
 * Azure AD bearer-token authentication.
 *
 * The SPA acquires an access token for this API's exposed scope and sends it as
 * `Authorization: Bearer <token>`. Every token is verified against the tenant's
 * published JWKS — signature, issuer, audience and expiry — before any route
 * runs. Roles are then resolved from the `admins` table, never from the token
 * or from anything the client sends.
 */

const TENANT_ID = process.env.AZURE_TENANT_ID || '';
const CLIENT_ID = process.env.AZURE_CLIENT_ID || '';

/**
 * Local development escape hatch: run the API without an Azure tenant.
 *
 * MUST be false in any shared or production environment. It is force-disabled
 * when NODE_ENV=production so a stray `true` in a deployed .env cannot open the
 * API up.
 */
const BYPASS_REQUESTED = String(process.env.DEV_AUTH_BYPASS).toLowerCase() === 'true';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
export const AUTH_BYPASSED = BYPASS_REQUESTED && !IS_PRODUCTION;

const BYPASS_EMAIL = (process.env.DEV_AUTH_EMAIL || process.env.SEED_ADMIN_EMAIL || '')
  .trim()
  .toLowerCase();

/**
 * Azure issues v2.0 tokens from this issuer and publishes keys at this JWKS
 * endpoint. `createRemoteJWKSet` caches keys and re-fetches on rotation.
 */
const ISSUER = `https://login.microsoftonline.com/${TENANT_ID}/v2.0`;
const JWKS_URL = `https://login.microsoftonline.com/${TENANT_ID}/discovery/v2.0/keys`;

let jwks = null;
function getJwks() {
  if (!jwks) jwks = createRemoteJWKSet(new URL(JWKS_URL));
  return jwks;
}

/** Report the auth configuration at boot so a misconfiguration is obvious. */
export function reportAuthConfig() {
  if (AUTH_BYPASSED) {
    console.warn(
      '[auth] *** DEV_AUTH_BYPASS IS ON — the API is UNAUTHENTICATED. ***\n' +
        `[auth] *** All requests act as "${BYPASS_EMAIL || 'unknown'}". ` +
        'Never use this outside local development. ***'
    );
    return;
  }

  if (BYPASS_REQUESTED && IS_PRODUCTION) {
    console.error(
      '[auth] DEV_AUTH_BYPASS=true was IGNORED because NODE_ENV=production. ' +
        'Remove it from the production environment.'
    );
  }

  if (!TENANT_ID || !CLIENT_ID) {
    console.error(
      '[auth] AZURE_TENANT_ID / AZURE_CLIENT_ID are not set, so no token can be ' +
        'verified and every request will be rejected with 401. Set them, or set ' +
        'DEV_AUTH_BYPASS=true for local development without a tenant.'
    );
    return;
  }

  console.log(`[auth] verifying Azure AD tokens for tenant ${TENANT_ID}`);
  console.log(`[auth] expected audience: ${CLIENT_ID} (or api://${CLIENT_ID})`);
}

/** Pull the bearer token out of the Authorization header. */
function readBearer(req) {
  const header = req.headers.authorization || '';
  const [scheme, value] = header.split(' ');
  if (!/^Bearer$/i.test(scheme || '') || !value) return null;
  return value.trim();
}

/**
 * Verify the token and attach `req.user`.
 *
 * Audience accepts both the bare client id and the `api://<client-id>` form,
 * because which one Azure stamps depends on how the scope was exposed.
 */
async function authenticate(req) {
  if (AUTH_BYPASSED) {
    req.user = { email: BYPASS_EMAIL, name: 'Local Dev', oid: 'dev-bypass' };
    return;
  }

  if (!TENANT_ID || !CLIENT_ID) {
    throw new ApiError(401, 'The API is not configured for authentication.');
  }

  const token = readBearer(req);
  if (!token) {
    throw new ApiError(401, 'Missing bearer token.');
  }

  let payload;
  try {
    ({ payload } = await jwtVerify(token, getJwks(), {
      issuer: ISSUER,
      audience: [CLIENT_ID, `api://${CLIENT_ID}`],
    }));
  } catch (err) {
    // Don't leak crypto/JWKS detail to the client; log it for diagnosis.
    console.warn(`[auth] token rejected: ${err.message}`);
    throw new ApiError(401, 'Invalid or expired token.');
  }

  // `preferred_username` carries the sign-in address on v2.0 tokens; upn and
  // email are fallbacks depending on the account type.
  const email = String(
    payload.preferred_username || payload.upn || payload.email || ''
  )
    .trim()
    .toLowerCase();

  if (!email) {
    throw new ApiError(401, 'Token does not identify a user.');
  }

  req.user = { email, name: payload.name || email, oid: payload.oid };
}

/** Whether an address currently holds admin access. */
async function isAdminEmail(email) {
  const { rowCount } = await query('SELECT 1 FROM admins WHERE email = $1', [email]);
  return rowCount > 0;
}

/** Require a valid token. */
export const requireAuth = asyncRoute(async (req, _res, next) => {
  await authenticate(req);
  next();
});

/**
 * Require a valid token AND admin access.
 *
 * Role comes from the database, so revoking someone's admin access takes effect
 * on their next request rather than when their token expires.
 */
export const requireAdmin = asyncRoute(async (req, _res, next) => {
  if (!req.user) await authenticate(req);

  if (!(await isAdminEmail(req.user.email))) {
    throw new ApiError(403, 'Admin access is required for this action.');
  }
  next();
});

export { isAdminEmail };
