// src/modules/auth/auth.service.js
// Resolves who somebody is, what they may do, and signs the token that says so.
// Identity is the verified mobile number; proving it is otp.service's job.
// Handles multi-tenant authentication and the guest/onboarding flow.

const { v4: uuidv4 } = require('uuid');
const { captureAudit } = require('../../utils/logger');
const jwt = require('jsonwebtoken');
const db = require('../../config/db');
const config = require('../../config/config');
const { logger } = require('../../utils/logger');
const { HttpError } = require('../../middleware/errorHandler');
const MESSAGES = require('../../config/messages');
const { QUERIES, STATUSES, SCOPES, AUDIT_CATEGORIES, AUDIT_ACTIONS } = require('../../config/constants');
const { JWT_SECRET } = require('../../config/envConfig');
const appConfig = require('../appconfig/appconfig.service');
const adminService = require('../admin/admin.service');
const invitationService = require('../invitation/invitation.service');
// Repository, not the service: mastersetup.service pulls in ~14 CRUD services.
// This file only needs the setup flag.
const setupRepository = require('../mastersetup/mastersetup.repository');
// One scope builder for every path that mints a token — see access.js.
const { getScopesForTenant, buildScopes, getRoleNames } = require('./access');


/**
 * Finds and retrieves user permissions. For provisioned users returns full
 * scopes; for unprovisioned users creates/looks up an onboarding request and
 * returns a guest token payload.
 * @param {Object} req - Express request object.
 * @param {Object} userData - Validated user data from Google.
 * @returns {Promise<Object>} User permissions object.
 */
const findAndGetPermissions = async (req, userData) => {
  // `let`, not `const`: the auto-approval path below gives this connection back
  // before opening its own transaction, then takes a fresh one.
  let connection = await db.getConnection();
  try {
    const { phone, name } = userData;

    // ── Claim invitations FIRST ────────────────────────────────────────────
    // Before memberships are read, and unconditionally — not inside the
    // "unknown phone" branch below. An existing user who has been invited to a
    // second tenancy already passes the provisioned path, so a claim placed
    // further down would never run for them. Running it here means one path
    // serves both "new person joins your tenancy" and "existing person gains
    // another".
    //
    // A failure must not cost the user their login: the invitation stays
    // PENDING and is claimed on the next attempt. This mirrors how the
    // auto-approval path below degrades to manual review.
    try {
      await invitationService.acceptPendingTx(connection, phone);
    } catch (inviteErr) {
      logger.error('Invitation claim failed; continuing sign-in', inviteErr);
    }

    const [tenantRows] = await connection.execute(QUERIES.USER_TENANTS.SELECT, [
      phone,
    ]);

    // ── Provisioned user path ──────────────────────────────────────────────
    // Now includes anything just claimed above, which is how an invited user
    // reaches their new tenancy on their very first sign-in without ever being
    // auto-provisioned one of their own.
    if (tenantRows.length > 0) {
      // USER_TENANTS.SELECT orders by last_active_at, so a member of several
      // tenancies resumes where they left off. This used to be row [0] of an
      // unordered query — arbitrary, and liable to change between logins.
      const selectedTenant = tenantRows[0];
      const tenantId = selectedTenant.tenant_id;

      // Remember where they are, so the next sign-in returns here.
      await connection.execute(QUERIES.USER_TENANTS.TOUCH_ACTIVE, [phone, tenantId]);

      const permissions = await buildScopes(connection, selectedTenant, tenantId, phone);
      const roles = await getRoleNames(connection, tenantId, phone);

      return {
        phone,
        // The MEMBERSHIP's name wins over anything the caller supplied. A
        // number identifies nobody, so the navbar, the audit trail and every
        // admin list need the name the tenancy knows them by — and the caller
        // only ever has one during a first-time signup, where there is no
        // membership to read it from.
        name: selectedTenant.full_name || name,
        tenantId,
        onboardingStatus: 'APPROVED',
        permissions,
        roles,
        associatedTenants: tenantRows,
        setupCompleted: await setupRepository.isSetupComplete(
          tenantId,
          connection
        ),
      };
    }

    // ── Guest / onboarding path (new) ──────────────────────────────────────
    const [existingRequests] = await connection.execute(
      QUERIES.ONBOARDING_REQUESTS.SELECT_BY_PHONE,
      [phone]
    );

    let requestId, onboardingStatus, rejectionReason = null;

    if (existingRequests.length > 0) {
      const existing = existingRequests[0];
      requestId = existing.id;
      onboardingStatus = existing.status;
      rejectionReason = existing.rejection_reason;
    } else {
      // Brand-new phone. When the super-admin has enabled auto-approval, provision
      // the user immediately into a new tenant as its TENANT_ADMIN and return an
      // APPROVED result. Any failure falls back to the manual PENDING flow below.
      if (await appConfig.isAutoApproveEnabled(connection)) {
        try {
          // autoApproveOnboarding opens its own transaction, which cannot share
          // this connection. Hold both at once and a single sign-in costs two
          // connections — the shape that deadlocks the pool under concurrent
          // logins. Give this one back for the duration and take a fresh one
          // after; nothing below depends on session state, only on committed
          // rows, which is why swapping connections here is safe.
          connection.release();
          connection = null;
          try {
            await adminService.autoApproveOnboarding({ phone, name });
          } finally {
            connection = await db.getConnection();
          }

          // Re-read the now-provisioned user exactly like the provisioned path.
          const [newTenantRows] = await connection.execute(
            QUERIES.USER_TENANTS.SELECT,
            [phone]
          );
          const selectedTenant = newTenantRows[0];
          const newTenantId = selectedTenant.tenant_id;

          const permissions = await buildScopes(connection, selectedTenant, newTenantId, phone);
          const roles = await getRoleNames(connection, newTenantId, phone);

          // Read everything that needs THIS connection before giving it back.
          // A freshly auto-provisioned tenant has no tenant_setup row, so this
          // resolves to false and the new tenant admin lands in the wizard.
          const setupCompleted = await setupRepository.isSetupComplete(
            newTenantId,
            connection
          );

          // Hand the connection back BEFORE writing the audit row.
          //
          // captureAudit goes through the POOL (db.execute), so calling it while
          // still holding a connection makes this request cost TWO — the exact
          // shape config.js warns about. It deadlocked in practice: one page
          // load fires six parallel calls against a pool of four, and this path
          // is slow enough (a whole tenant is provisioned first) to still be
          // holding its connection when they land. Every one of them then waits
          // for a connection nobody is left to release, and mysql2 has no
          // acquire timeout to break the tie — sign-up hung forever while the
          // tenancy sat committed in the database.
          //
          // Nulled so the outer finally does not release it a second time.
          connection.release();
          connection = null;

          await captureAudit(
            req, newTenantId, phone,
            AUDIT_ACTIONS.ONBOARDING_AUTO_APPROVED, STATUSES.SUCCESS,
            AUDIT_CATEGORIES.ONBOARDING, 'INFO', null
          );

          return {
            phone,
            name,
            tenantId: newTenantId,
            onboardingStatus: 'APPROVED',
            permissions,
            roles,
            associatedTenants: newTenantRows,
            setupCompleted,
          };
        } catch (autoErr) {
          logger.error(
            'Onboarding auto-approval failed; falling back to manual review',
            autoErr
          );
          // fall through to the manual PENDING flow
        }
      }

      requestId = uuidv4();
      await connection.execute(QUERIES.ONBOARDING_REQUESTS.INSERT, [
        requestId,
        phone,
        name,
      ]);
      onboardingStatus = 'PENDING';
    }

    // Same reason as the auto-approval path above: captureAudit takes its own
    // connection from the pool, so holding one here would make this request
    // cost two and starve a pool that a single page load already saturates.
    // Everything that needed the connection is done by this point.
    connection.release();
    connection = null;

    await captureAudit(
      req, null, phone,
      AUDIT_ACTIONS.ONBOARDING_ATTEMPT, STATUSES.SUCCESS,
      AUDIT_CATEGORIES.AUTH, 'INFO', requestId
    );

    return {
      phone,
      name,
      tenantId: null,
      onboardingStatus,
      onboardingRequestId: requestId,
      rejectionReason: onboardingStatus === 'REJECTED' ? rejectionReason : null,
      permissions: [SCOPES.GUEST_EXPLORE],
      roles: [],
      associatedTenants: [],
    };
  } catch (error) {
    logger.error('Multi-Tenant Auth Error:', error);
    throw error;
  } finally {
    if (connection) connection.release();
  }
};

// Tenant switching lives in modules/tenant/tenant.service.js (POST
// /api/tenants/switch). It builds its scopes with the same access.js builder.

/**
 * Generates a signed JWT. Guest tokens use a shorter expiry.
 * @param {Object} userPermissions - User permissions object.
 * @returns {string} Signed JWT.
 */
const generateAppToken = (userPermissions) => {
  const isGuest = userPermissions.onboardingStatus !== 'APPROVED';

  const appPayload = {
    // The identity claim. Renamed from `phone` with the migration — every
    // consumer (authMiddleware, checkScope, auditLogger, the setup gate)
    // reads this one field, so the rename is the whole of their change.
    phone: userPermissions.phone,
    name: userPermissions.name,
    tid: userPermissions.tenantId,
    scopes: userPermissions.permissions,
    onboardingStatus: userPermissions.onboardingStatus || 'APPROVED',
    roles: userPermissions.roles || [],
    associatedTenants: (userPermissions.associatedTenants || []).map((t) => ({
      tenantId: t.tenant_id,
      // Shown in the tenant switcher; null for a tenancy with no organization yet.
      name: t.tenant_name || null,
      isAdmin: t.is_admin === 1 || t.is_admin === true,
    })),
    iss: MESSAGES.JWT.ISSUER,
  };

  if (userPermissions.onboardingRequestId) {
    appPayload.onboardingRequestId = userPermissions.onboardingRequestId;
  }

  // First-time tenancy setup flag, for provisioned users only (guests have no
  // tenant to set up). Only ever written when the caller resolved it, so the
  // claim is absent — and therefore non-blocking — on any path that did not.
  if (!isGuest && userPermissions.setupCompleted !== undefined) {
    appPayload.setupCompleted = !!userPermissions.setupCompleted;
  }

  const expiry = isGuest ? config.JWT.GUEST_EXPIRATION : config.JWT.EXPIRATION;
  return jwt.sign(appPayload, JWT_SECRET, { expiresIn: expiry });
};

/**
 * Re-signs the caller's current token with setupCompleted: true.
 *
 * Used the moment the setup wizard succeeds: the bearer token in that very
 * request still says the tenant is incomplete, so returning a refreshed one
 * unlocks the app without forcing a re-login. Identity, scopes, roles and
 * tenant list are carried over verbatim — nothing is elevated here, only the
 * setup flag changes.
 *
 * @param {Object} tokenPayload - Decoded JWT payload from req.user.
 * @returns {string} Newly signed JWT.
 */
const reissueTokenWithSetupComplete = (tokenPayload) => {
  // Drop the previous iat/exp — jwt.sign issues fresh ones, and passing the old
  // values alongside expiresIn is an error.
  const claims = { ...tokenPayload };
  delete claims.iat;
  delete claims.exp;

  return jwt.sign(
    { ...claims, setupCompleted: true },
    JWT_SECRET,
    { expiresIn: config.JWT.EXPIRATION }
  );
};

module.exports = {
  findAndGetPermissions,
  generateAppToken,
  reissueTokenWithSetupComplete,
  // Exported for scripts/admin-token.js (break-glass access). It is read-only
  // and side-effect free, which findAndGetPermissions is not — that one claims
  // invitations and can create onboarding requests, neither of which an
  // emergency tool should do on a mistyped identity.
  getScopesForTenant,
};
