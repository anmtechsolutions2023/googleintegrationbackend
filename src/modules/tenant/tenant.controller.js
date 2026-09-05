// src/modules/tenant/tenant.controller.js
// Controller layer for tenant operations.
// Handles request/response logic for tenant switching.

const Joi = require('joi');
const { logger } = require('../../utils/logger');
const MESSAGES = require('../../config/messages');
const { HttpError } = require('../../middleware/errorHandler');
const tenantService = require('./tenant.service');
const { generateAppToken } = require('../auth/auth.service');

// Validation schemas
const switchTenantSchema = Joi.object({
  tenantId: Joi.string().uuid().required(),
});

/**
 * Handles tenant switching.
 * @param {Object} req - Express request.
 * @param {Object} res - Express response.
 * @param {Function} next - Express next.
 */
const switchTenant = async (req, res, next) => {
  try {
    logger.info('Switch tenant request', { user: req.user.phone });

    // Validate input
    const { error, value } = switchTenantSchema.validate(req.body);
    if (error) {
      logger.warn('Switch tenant validation failed', { error: error.details });
      return next(
        new HttpError(
          `${MESSAGES.ERROR.VALIDATION_ERROR}${error.details[0].message}`,
          MESSAGES.HTTP_STATUS.BAD_REQUEST
        )
      );
    }

    const { tenantId } = value;
    const userPhone = req.user.phone;
    const userName = req.user.name;

    // Call service
    const newPermissions = await tenantService.switchTenantPermissions(
      req,
      userPhone,
      tenantId,
      userName
    );
    const newToken = generateAppToken(newPermissions);

    logger.info('Tenant switched successfully', { userPhone, tenantId });
    res.json({
      success: true,
      message: `${MESSAGES.SUCCESS.TENANT_SWITCH}${tenantId}`,
      token: newToken,
    });
  } catch (error) {
    logger.error('Switch tenant controller error', error);
    next(error);
  }
};

module.exports = {
  switchTenant,
};
