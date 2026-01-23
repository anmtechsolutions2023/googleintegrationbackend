// src/modules/auth/auth.service.js
// Service for Google OAuth validation, user permissions, and JWT generation.
// Handles multi-tenant authentication and tenant switching.

const { OAuth2Client } = require('google-auth-library');
const { captureAudit } = require('../../utils/logger');
const jwt = require('jsonwebtoken');
const db = require('../../config/db');
const config = require('../../config/config');
const { logger } = require('../../utils/logger');
const MESSAGES = require('../../config/messages');
const { QUERIES, STATUSES, SCOPES } = require('../../config/constants');
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
 * Fetches scopes for a specific user-tenant membership.
 * @param {Object} connection - Database connection.
 * @param {string} tenantId - Tenant ID.
 * @param {string} userEmail - User email.
 * @returns {Promise<string[]>} Array of scopes.
 */
const getScopesForTenant = async (connection, tenantId, userEmail) => {
  const [featureRows] = await connection.execute(QUERIES.PERMISSIONS_SELECT, [
    tenantId,
    userEmail,
  ]);
  return featureRows.map((row) => `${row.feature_short_name}:${row.scope}`);
};

/**
 * Finds and retrieves user permissions for login.
 * @param {Object} req - Express request object.
 * @param {Object} userData - Validated user data.
 * @returns {Promise<Object>} User permissions object.
 */
const findAndGetPermissions = async (req, userData) => {
  const connection = await db.getConnection();
  try {
    const userEmail = userData.email;

    const [tenantRows] = await connection.execute(QUERIES.USER_TENANTS_SELECT, [
      userEmail,
    ]);

    if (tenantRows.length === 0) {
      await captureAudit(
        req,
        null,
        userEmail,
        STATUSES.LOGIN_ATTEMPT,
        STATUSES.NOT_FOUND
      );
      throw new Error(MESSAGES.ERROR.USER_NOT_ASSOCIATED);
    }

    const selectedTenant = tenantRows[0];
    const tenantId = selectedTenant.tenant_id;

    const permissions = await getScopesForTenant(
      connection,
      tenantId,
      userEmail
    );

    // When user is admin for the tenant, add admin scope
    if (selectedTenant.is_admin) {
      permissions.push(SCOPES.TENANT_ADMIN);
    }

    // When user is super admin for the tenant, add super admin scope
    if (selectedTenant.is_super_admin) {
      permissions.push(SCOPES.TENANT_SUPER_ADMIN);
    }

    return {
      email: userEmail,
      name: userData.name,
      tenantId,
      permissions,
      associatedTenants: tenantRows,
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
    const [tenantRows] = await connection.execute(QUERIES.USER_TENANTS_SELECT, [
      userEmail,
    ]);

    const targetTenant = tenantRows.find((t) => t.tenant_id === targetTenantId);

    if (!targetTenant) {
      await captureAudit(
        req,
        null,
        userEmail,
        STATUSES.SWITCH_TENANT_DENIED,
        STATUSES.FORBIDDEN
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
      permissions,
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
 * Generates a JWT with user permissions.
 * @param {Object} userPermissions - User permissions object.
 * @returns {string} JWT token.
 */
const generateAppToken = (userPermissions) => {
  const appPayload = {
    email: userPermissions.email,
    name: userPermissions.name,
    tid: userPermissions.tenantId,
    scopes: userPermissions.permissions,
    associatedTenants: userPermissions.associatedTenants.map((t) => ({
      tenantId: t.tenant_id,
      isAdmin: t.is_admin === 1 || t.is_admin === true,
    })),
    iss: MESSAGES.JWT.ISSUER,
  };

  return jwt.sign(appPayload, JWT_SECRET, { expiresIn: config.JWT.EXPIRATION });
};

module.exports = {
  validateGoogleToken,
  findAndGetPermissions,
  switchTenantPermissions,
  generateAppToken,
};
