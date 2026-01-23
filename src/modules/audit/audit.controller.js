// src/modules/audit/audit.controller.js
// Controller layer for audit log operations.
// Handles request/response logic, input validation, and error handling.

const Joi = require('joi');
const { logger } = require('../../utils/logger');
const MESSAGES = require('../../config/messages');
const { HttpError } = require('../../middleware/errorHandler');
const auditService = require('./audit.service');

// Validation schemas
const auditLogsQuerySchema = Joi.object({
  userEmail: Joi.string().email().optional(),
});

/**
 * Handles audit logs retrieval.
 * @param {Object} req - Express request.
 * @param {Object} res - Express response.
 * @param {Function} next - Express next.
 */
const getAuditLogs = async (req, res, next) => {
  try {
    logger.info('Get audit logs request', { user: req.user.email });

    // Validate query params
    const { error, value } = auditLogsQuerySchema.validate(req.query);
    if (error) {
      logger.warn('Audit logs validation failed', { error: error.details });
      return next(
        new HttpError(
          `${MESSAGES.ERROR.VALIDATION_ERROR}${error.details[0].message}`,
          MESSAGES.HTTP_STATUS.BAD_REQUEST
        )
      );
    }

    // Get user tenants
    const allRows = await auditService.getUserTenants(req.user.email);
    const adminTenants = allRows
      .filter((row) => row.tenant_id === req.user.tid && row.is_admin)
      .map((row) => row.tenant_id);

    const isAdmin = adminTenants.length > 0;
    const filters = {
      tenantIds: isAdmin ? adminTenants : [req.user.tid],
      userEmail: isAdmin ? value.userEmail : req.user.email,
    };

    // Call service
    const logs = await auditService.getAuditLogs(filters);

    logger.info('Audit logs retrieved', { count: logs.length });
    res.json({
      message: MESSAGES.SUCCESS.AUDIT_LOGS_RETRIEVED,
      logs,
      isAdmin,
      associatedTenants: allRows.map((row) => ({
        tenantId: row.tenant_id,
        isAdmin: row.is_admin,
      })),
    });
  } catch (error) {
    logger.error('Get audit logs controller error', error);
    next(error);
  }
};

module.exports = {
  getAuditLogs,
};
