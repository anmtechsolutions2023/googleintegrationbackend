// src/middleware/setupGate.js
// Enforces the first-time tenancy setup gate.
//
// Until a tenant completes the master-data setup wizard
// (POST /api/master-data/bootstrap), its users may only reach sign-in, the
// onboarding flow, logout/profile, audit logs and the wizard itself. Everything
// else answers 403 TENANT_SETUP_REQUIRED. Blocking here — rather than only in
// the UI — is what makes direct URL / direct API access impossible.
//
// Registered ONCE in src/config/routes.js, ahead of every module router, so
// there is a single place to audit what is and isn't gated. Any route added
// later inherits the gate automatically.
//
// ── Backward compatibility ───────────────────────────────────────────────────
// The gate keys off the `setupCompleted` JWT claim, and ONLY an explicit `false`
// blocks. Tokens minted before this feature shipped carry no such claim and pass
// through untouched, so already-signed-in users are never locked out mid-session
// and no existing caller changes behaviour. Once those tokens expire, the next
// sign-in issues a claim reflecting the tenant's real state.

const jwt = require('jsonwebtoken');
const { HttpError } = require('./errorHandler');
const MESSAGES = require('../config/messages');
const { JWT_SECRET } = require('../config/envConfig');
const { SCOPES, TENANT_SETUP } = require('../config/constants');
const { logger } = require('../utils/logger');
const setupRepository = require('../modules/mastersetup/mastersetup.repository');

/**
 * True when the request path is one of the always-reachable prefixes.
 * @param {string} path - Request path.
 * @returns {boolean}
 */
const isAllowedPath = (path) => {
  if (path === '/') return true; // health check / API index
  return TENANT_SETUP.ALLOWED_PATH_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`)
  );
};

/**
 * Decodes the bearer token without throwing. Returns null when the header is
 * missing or the token is unusable — the downstream router's authenticateToken
 * is responsible for producing the 401/403 in that case, not this gate.
 * @param {Object} req - Express request.
 * @returns {Object|null} Verified JWT payload, or null.
 */
const readToken = (req) => {
  const authHeader = req.headers[MESSAGES.HTTP_HEADER.AUTHORIZATION];
  const token =
    authHeader && authHeader.split(' ')[MESSAGES.HTTP_HEADER.BEARER_SPLIT_INDEX];
  if (!token) return null;
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
};

/**
 * Blocks requests from tenants that have not completed first-time setup.
 * @param {Object} req - Express request.
 * @param {Object} res - Express response.
 * @param {Function} next - Express next.
 */
const requireTenantSetup = async (req, res, next) => {
  try {
    // 1) Always-reachable paths (wizard, auth, audit, logout, onboarding).
    if (isAllowedPath(req.path)) return next();

    // 2) Unauthenticated / unreadable token — let the route's own auth answer.
    const user = readToken(req);
    if (!user) return next();

    // 3) Super admins bypass the gate, mirroring the super-admin bypass in
    //    checkScope. They need cross-tenant access (including the setup
    //    tracker in the admin panel) regardless of their own tenant's state.
    const scopes = Array.isArray(user.scopes) ? user.scopes : [];
    if (scopes.includes(SCOPES.TENANT_SUPER_ADMIN)) return next();

    // 4) Guests have no tenant to set up; their routes are allowlisted above
    //    and everything else already fails on scope.
    if (!user.tid) return next();

    // 5) Anything other than an explicit `false` passes — see the note above.
    if (user.setupCompleted !== false) return next();

    // 6) Claim says incomplete. Re-check the database before blocking so a user
    //    holding a token issued moments before they finished the wizard is not
    //    stuck. This query only runs for tenants genuinely mid-setup.
    if (await setupRepository.isSetupComplete(user.tid)) return next();

    logger.warn('Request blocked — tenancy setup incomplete', {
      tenantId: user.tid,
      phone: user.phone,
      path: req.path,
    });

    return next(
      new HttpError(
        MESSAGES.ERROR.TENANT_SETUP_REQUIRED,
        MESSAGES.HTTP_STATUS.FORBIDDEN,
        TENANT_SETUP.ERROR_CODE
      )
    );
  } catch (error) {
    return next(error);
  }
};

module.exports = { requireTenantSetup, isAllowedPath };
