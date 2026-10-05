// src/modules/tenant/tenant.service.js
// Service layer for tenant operations.
// Handles tenant switching and permission management.

const db = require('../../config/db');
const { logger, captureAudit } = require('../../utils/logger');
const { QUERIES, STATUSES, AUDIT_CATEGORIES, AUDIT_ACTIONS } = require('../../config/constants');
const MESSAGES = require('../../config/messages');
const { HttpError } = require('../../middleware/errorHandler');
// The one scope builder for every path that mints a token — see auth/access.js.
const { buildScopes, getRoleNames } = require('../auth/access');
// Repository, not the service: only the setup flag is needed here.
const setupRepository = require('../mastersetup/mastersetup.repository');

/**
 * Switches tenant permissions for an authenticated user.
 *
 * POST /api/tenants/switch. Yields what a fresh sign-in into the target tenancy
 * would: the same scope builder as sign-in (roles, the Admin switch and the
 * super-admin flag), the role names, the target's setup state, and
 * onboardingStatus APPROVED — without which generateAppToken treated the
 * result as a guest's and signed a 15-minute token. This used to read only the
 * legacy per-membership grant table, so a switched-into token carried no role
 * permissions at all.
 *
 * @param {Object} req - Express request object.
 * @param {string} userPhone - The verified mobile number, E.164.
 * @param {string} targetTenantId - Target tenant ID.
 * @param {string} userName - User name, used when the membership has none.
 * @returns {Promise<Object>} Input for generateAppToken.
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
      await captureAudit(
        req, null, userPhone,
        AUDIT_ACTIONS.SWITCH_TENANT_DENIED, STATUSES.DENIED,
        AUDIT_CATEGORIES.TENANT_MGMT, 'WARN', targetTenantId
      );
      throw new HttpError(MESSAGES.ERROR.TENANT_ACCESS_DENIED, 403);
    }

    const permissions = await buildScopes(connection, targetTenant, targetTenantId, userPhone);
    const roles = await getRoleNames(connection, targetTenantId, userPhone);
    // Resolved for the TARGET tenant: a user who belongs to a set-up tenant and
    // an unfinished one must be gated after switching into the latter.
    const setupCompleted = await setupRepository.isSetupComplete(targetTenantId, connection);

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
      // The membership's name wins, as at sign-in.
      name: targetTenant.full_name || userName,
      tenantId: targetTenantId,
      onboardingStatus: 'APPROVED',
      permissions,
      roles,
      associatedTenants: tenantRows,
      setupCompleted,
    };
  } catch (error) {
    logger.error('Switch tenant error', error);
    throw error;
  } finally {
    connection.release();
  }
};

module.exports = {
  switchTenantPermissions,
};
