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
const MESSAGES = require('../../config/messages');
const { QUERIES, STATUSES, SCOPES, AUDIT_CATEGORIES, AUDIT_ACTIONS } = require('../../config/constants');
const { GOOGLE_CLIENT_ID, JWT_SECRET } = require('../../config/envConfig');

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
    throw new Error(
      `${MESSAGES.ERROR.GOOGLE_VALIDATION_FAILED}${error.message}`
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

    const [tenantRows] = await connection.execute(QUERIES.USER_TENANTS.SELECT, [
      email,
    ]);

    // ── Provisioned user path (existing behaviour, unchanged) ──────────────
    if (tenantRows.length > 0) {
      const selectedTenant = tenantRows[0];
      const tenantId = selectedTenant.tenant_id;

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

  const expiry = isGuest ? config.JWT.GUEST_EXPIRATION : config.JWT.EXPIRATION;
  return jwt.sign(appPayload, JWT_SECRET, { expiresIn: expiry });
};

module.exports = {
  validateGoogleToken,
  findAndGetPermissions,
  switchTenantPermissions,
  generateAppToken,
};
