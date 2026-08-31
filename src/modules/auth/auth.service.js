// src/modules/auth/auth.service.js
// Service for Google OAuth validation, user permissions, and JWT generation.
// Handles multi-tenant authentication and the guest/onboarding flow.

const { OAuth2Client } = require('google-auth-library');
const { v4: uuidv4 } = require('uuid');
const { captureAudit } = require('../../utils/logger');
const jwt = require('jsonwebtoken');
const db = require('../../config/db');
const config = require('../../config/config');
const { logger } = require('../../utils/logger');
const { HttpError } = require('../../middleware/errorHandler');
const MESSAGES = require('../../config/messages');
const { QUERIES, STATUSES, SCOPES, AUDIT_CATEGORIES, AUDIT_ACTIONS } = require('../../config/constants');
const { GOOGLE_CLIENT_ID, JWT_SECRET } = require('../../config/envConfig');
const appConfig = require('../appconfig/appconfig.service');
const adminService = require('../admin/admin.service');
const invitationService = require('../invitation/invitation.service');
// Repository, not the service: mastersetup.service pulls in ~14 CRUD services.
// This file only needs the setup flag.
const setupRepository = require('../mastersetup/mastersetup.repository');

const GOOGLE_OAUTH2_CLIENT = new OAuth2Client(GOOGLE_CLIENT_ID);

/**
 * Validates a Google ID token and extracts user info.
 * @param {string} idToken - Google ID token.
 * @returns {Promise<Object>} Validated user data.
 */
const validateGoogleToken = async (idToken) => {
  try {
    logger.info('Validating Google ID token...');
    logger.info(`Expected audience (client ID): ${GOOGLE_CLIENT_ID}`);

    const ticket = await GOOGLE_OAUTH2_CLIENT.verifyIdToken({
      idToken: idToken,
      audience: GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();

    logger.info(`Token audience: ${payload.aud}`);
    logger.info(`Token issuer: ${payload.iss}`);
    logger.info(`User email: ${payload.email}`);

    if (!payload || !payload.email) {
      throw new Error(MESSAGES.ERROR.INVALID_PAYLOAD);
    }

    return { email: payload.email, name: payload.name, googleId: payload.sub };
  } catch (error) {
    logger.error('Google token validation error:', error.message);
    // 401 belongs here, on the one failure that genuinely means "we do not
    // accept this caller". Everything further down the sign-in path is an
    // infrastructure failure and must not borrow this status.
    throw new HttpError(
      `${MESSAGES.ERROR.GOOGLE_VALIDATION_FAILED}${error.message}`,
      MESSAGES.HTTP_STATUS.UNAUTHORIZED
    );
  }
};

/**
 * Resolves scopes for a user in a tenant from both direct grants (Path B)
 * and role-based grants (Path A). Returns a deduplicated union.
 * @param {Object} connection - Database connection.
 * @param {string} tenantId - Tenant ID.
 * @param {string} userEmail - User email.
 * @returns {Promise<string[]>} Deduplicated array of scope strings.
 */
const getScopesForTenant = async (connection, tenantId, userEmail) => {
  // Path B (existing): direct feature grants via tenant_features
  const [directRows] = await connection.execute(QUERIES.PERMISSIONS.SELECT, [
    tenantId,
    userEmail,
  ]);
  const directScopes = directRows.map((r) => `${r.feature_short_name}:${r.scope}`);

  // Path A (new): role-based grants via user_roles → role_permissions → features
  const [roleRows] = await connection.execute(
    QUERIES.ROLE_SCOPES.SELECT_BY_USER_TENANT,
    [userEmail, tenantId]
  );
  const roleScopes = roleRows.map((r) => `${r.feature_short_name}:${r.scope}`);

  return [...new Set([...directScopes, ...roleScopes])];
};

/**
 * Finds and retrieves user permissions. For provisioned users returns full
 * scopes; for unprovisioned users creates/looks up an onboarding request and
 * returns a guest token payload.
 * @param {Object} req - Express request object.
 * @param {Object} userData - Validated user data from Google.
 * @returns {Promise<Object>} User permissions object.
 */
const findAndGetPermissions = async (req, userData) => {
  const connection = await db.getConnection();
  try {
    const { email, name, googleId } = userData;

    // ── Claim invitations FIRST ────────────────────────────────────────────
    // Before memberships are read, and unconditionally — not inside the
    // "unknown email" branch below. An existing user who has been invited to a
    // second tenancy already passes the provisioned path, so a claim placed
    // further down would never run for them. Running it here means one path
    // serves both "new person joins your tenancy" and "existing person gains
    // another".
    //
    // A failure must not cost the user their login: the invitation stays
    // PENDING and is claimed on the next attempt. This mirrors how the
    // auto-approval path below degrades to manual review.
    try {
      await invitationService.acceptPendingTx(connection, email);
    } catch (inviteErr) {
      logger.error('Invitation claim failed; continuing sign-in', inviteErr);
    }

    const [tenantRows] = await connection.execute(QUERIES.USER_TENANTS.SELECT, [
      email,
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
      await connection.execute(QUERIES.USER_TENANTS.TOUCH_ACTIVE, [email, tenantId]);

      const permissions = await getScopesForTenant(connection, tenantId, email);

      if (selectedTenant.is_admin) permissions.push(SCOPES.TENANT_ADMIN);
      if (selectedTenant.is_super_admin) permissions.push(SCOPES.TENANT_SUPER_ADMIN);

      const [roleRows] = await connection.execute(
        QUERIES.USER_ROLES.SELECT_BY_USER_TENANT,
        [email, tenantId]
      );

      return {
        email,
        name,
        tenantId,
        onboardingStatus: 'APPROVED',
        permissions,
        roles: roleRows.map((r) => r.role_name),
        associatedTenants: tenantRows,
        setupCompleted: await setupRepository.isSetupComplete(tenantId),
      };
    }

    // ── Guest / onboarding path (new) ──────────────────────────────────────
    const [existingRequests] = await connection.execute(
      QUERIES.ONBOARDING_REQUESTS.SELECT_BY_EMAIL,
      [email]
    );

    let requestId, onboardingStatus, rejectionReason = null;

    if (existingRequests.length > 0) {
      const existing = existingRequests[0];
      requestId = existing.id;
      onboardingStatus = existing.status;
      rejectionReason = existing.rejection_reason;
    } else {
      // Brand-new email. When the super-admin has enabled auto-approval, provision
      // the user immediately into a new tenant as its TENANT_ADMIN and return an
      // APPROVED result. Any failure falls back to the manual PENDING flow below.
      if (await appConfig.isAutoApproveEnabled()) {
        try {
          await adminService.autoApproveOnboarding({ email, name, googleSub: googleId });

          // Re-read the now-provisioned user exactly like the provisioned path.
          const [newTenantRows] = await connection.execute(
            QUERIES.USER_TENANTS.SELECT,
            [email]
          );
          const selectedTenant = newTenantRows[0];
          const newTenantId = selectedTenant.tenant_id;

          const permissions = await getScopesForTenant(connection, newTenantId, email);
          if (selectedTenant.is_admin) permissions.push(SCOPES.TENANT_ADMIN);
          if (selectedTenant.is_super_admin) permissions.push(SCOPES.TENANT_SUPER_ADMIN);

          const [roleRows] = await connection.execute(
            QUERIES.USER_ROLES.SELECT_BY_USER_TENANT,
            [email, newTenantId]
          );

          await captureAudit(
            req, newTenantId, email,
            AUDIT_ACTIONS.ONBOARDING_AUTO_APPROVED, STATUSES.SUCCESS,
            AUDIT_CATEGORIES.ONBOARDING, 'INFO', null
          );

          return {
            email,
            name,
            tenantId: newTenantId,
            onboardingStatus: 'APPROVED',
            permissions,
            roles: roleRows.map((r) => r.role_name),
            associatedTenants: newTenantRows,
            // A freshly auto-provisioned tenant has no tenant_setup row, so this
            // resolves to false and the new tenant admin lands in the wizard.
            setupCompleted: await setupRepository.isSetupComplete(newTenantId),
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
        email,
        name,
        googleId || null,
      ]);
      onboardingStatus = 'PENDING';
    }

    await captureAudit(
      req, null, email,
      AUDIT_ACTIONS.ONBOARDING_ATTEMPT, STATUSES.SUCCESS,
      AUDIT_CATEGORIES.AUTH, 'INFO', requestId
    );

    return {
      email,
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
    connection.release();
  }
};

/**
 * Switches tenant permissions for an authenticated user.
 * @param {Object} req - Express request object.
 * @param {string} userEmail - User email.
 * @param {string} targetTenantId - Target tenant ID.
 * @param {string} userName - User name.
 * @returns {Promise<Object>} New permissions object.
 */
const switchTenantPermissions = async (
  req,
  userEmail,
  targetTenantId,
  userName
) => {
  const connection = await db.getConnection();
  try {
    const [tenantRows] = await connection.execute(QUERIES.USER_TENANTS.SELECT, [
      userEmail,
    ]);

    const targetTenant = tenantRows.find((t) => t.tenant_id === targetTenantId);

    if (!targetTenant) {
      await captureAudit(
        req, null, userEmail,
        AUDIT_ACTIONS.SWITCH_TENANT_DENIED, STATUSES.DENIED,
        AUDIT_CATEGORIES.TENANT_MGMT, 'WARN', targetTenantId
      );
      throw new Error(MESSAGES.ERROR.TENANT_ACCESS_DENIED);
    }

    const permissions = await getScopesForTenant(
      connection,
      targetTenantId,
      userEmail
    );

    if (targetTenant.is_admin) {
      permissions.push(SCOPES.TENANT_ADMIN);
    }

    return {
      email: userEmail,
      name: userName,
      tenantId: targetTenantId,
      onboardingStatus: 'APPROVED',
      permissions,
      roles: [],
      associatedTenants: tenantRows,
      // Resolved for the TARGET tenant: a user who belongs to a set-up tenant
      // and an unfinished one must be gated after switching into the latter.
      setupCompleted: await setupRepository.isSetupComplete(targetTenantId),
    };
  } catch (error) {
    logger.error('Switch Tenant Error:', error);
    throw error;
  } finally {
    connection.release();
  }
};

/**
 * Generates a signed JWT. Guest tokens use a shorter expiry.
 * @param {Object} userPermissions - User permissions object.
 * @returns {string} Signed JWT.
 */
const generateAppToken = (userPermissions) => {
  const isGuest = userPermissions.onboardingStatus !== 'APPROVED';

  const appPayload = {
    email: userPermissions.email,
    name: userPermissions.name,
    tid: userPermissions.tenantId,
    scopes: userPermissions.permissions,
    onboardingStatus: userPermissions.onboardingStatus || 'APPROVED',
    roles: userPermissions.roles || [],
    associatedTenants: (userPermissions.associatedTenants || []).map((t) => ({
      tenantId: t.tenant_id,
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
  validateGoogleToken,
  findAndGetPermissions,
  switchTenantPermissions,
  generateAppToken,
  reissueTokenWithSetupComplete,
};
