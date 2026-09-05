// src/modules/tenant/tenant.service.js
// Service layer for tenant operations.
// Handles tenant switching and permission management.

const db = require('../../config/db');
const { logger } = require('../../utils/logger');
const { QUERIES, SCOPES } = require('../../config/constants');
const MESSAGES = require('../../config/messages');
const { HttpError } = require('../../middleware/errorHandler');

/**
 * Switches tenant permissions for an authenticated user.
 * @param {Object} req - Express request object.
 * @param {string} userPhone - User email.
 * @param {string} targetTenantId - Target tenant ID.
 * @param {string} userName - User name.
 * @returns {Promise<Object>} New permissions object.
 */
const switchTenantPermissions = async (
  req,
  userPhone,
  targetTenantId,
  userName
) => {
  logger.info('Switching tenant permissions', { userPhone, targetTenantId });

  const connection = await db.getConnection();
  try {
    const [tenantRows] = await connection.execute(QUERIES.USER_TENANTS.SELECT, [
      userPhone,
    ]);

    const targetTenant = tenantRows.find((t) => t.tenant_id === targetTenantId);
    if (!targetTenant) {
      logger.warn('Tenant access denied', { userPhone, targetTenantId });
      throw new HttpError(MESSAGES.ERROR.TENANT_ACCESS_DENIED, 403);
    }

    // Fetch permissions
    const permissions = await getScopesForTenant(
      connection,
      targetTenantId,
      userPhone
    );
    if (targetTenant.is_admin) {
      permissions.push(SCOPES.TENANT_ADMIN);
    }
    // Mirrors the login path. Without this a super admin who switched tenancy
    // silently lost TENANT:SUPER_ADMIN — and with it the checkScope bypass —
    // until they logged in again, so cross-tenant screens went 403 mid-session.
    if (targetTenant.is_super_admin) {
      permissions.push(SCOPES.TENANT_SUPER_ADMIN);
    }

    // Remember the choice: login orders memberships by last_active_at, so the
    // next sign-in resumes the tenancy they switched to rather than an
    // arbitrary one.
    await connection.execute(QUERIES.USER_TENANTS.TOUCH_ACTIVE, [
      userPhone,
      targetTenantId,
    ]);

    logger.info('Tenant switch successful', { userPhone, targetTenantId });
    return {
      phone: userPhone,
      name: userName,
      tenantId: targetTenantId,
      permissions,
      associatedTenants: tenantRows,
    };
  } catch (error) {
    logger.error('Switch tenant error', error);
    throw error;
  } finally {
    connection.release();
  }
};

/**
 * Helper: Fetches scopes for a tenant.
 * @param {Object} connection - DB connection.
 * @param {string} tenantId - Tenant ID.
 * @param {string} userPhone - User email.
 * @returns {Promise<string[]>} Array of scopes.
 */
const getScopesForTenant = async (connection, tenantId, userPhone) => {
  const [featureRows] = await connection.execute(QUERIES.PERMISSIONS.SELECT, [
    tenantId,
    userPhone,
  ]);
  return featureRows.map((row) => `${row.feature_short_name}:${row.scope}`);
};

module.exports = {
  switchTenantPermissions,
};
