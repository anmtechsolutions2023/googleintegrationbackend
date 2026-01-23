// src/modules/auth/auth.controller.js
// Controller layer for authentication routes.
// Handles request/response logic, input validation, and error handling for auth operations.

const Joi = require('joi');
const { logger } = require('../../utils/logger');
const MESSAGES = require('../../config/messages');
const { STATUSES } = require('../../config/constants');
const { HttpError } = require('../../middleware/errorHandler');
const { captureAudit } = require('../../utils/logger');
const authService = require('./auth.service');

// Validation schemas
const googleAuthSchema = Joi.object({
  id_token: Joi.string().required(),
});

/**
 * Handles Google OAuth authentication.
 * @param {Object} req - Express request.
 * @param {Object} res - Express response.
 * @param {Function} next - Express next.
 */
const googleAuth = async (req, res, next) => {
  try {
    logger.info('Google auth request', { ip: req.ip });

    // Validate input
    const { error, value } = googleAuthSchema.validate(req.body);
    if (error) {
      logger.warn('Google auth validation failed', { error: error.details });
      return next(
        new HttpError(
          `${MESSAGES.ERROR.VALIDATION_ERROR}${error.details[0].message}`,
          MESSAGES.HTTP_STATUS.BAD_REQUEST
        )
      );
    }

    const { id_token } = value;

    // Call service
    const validatedUser = await authService.validateGoogleToken(id_token);
    const userPermissions = await authService.findAndGetPermissions(
      req,
      validatedUser
    );
    const appToken = authService.generateAppToken(userPermissions);

    // Log success
    await captureAudit(
      req,
      userPermissions.tenantId,
      userPermissions.email,
      STATUSES.LOGIN_SUCCESS,
      STATUSES.SUCCESS
    );

    logger.info('Google auth successful', {
      email: userPermissions.email,
      tenantId: userPermissions.tenantId,
    });

    res.json({
      success: true,
      message: MESSAGES.SUCCESS.AUTH,
      token: appToken,
      user: {
        email: userPermissions.email,
        tenant_id: userPermissions.tenantId,
        scopes: userPermissions.permissions,
      },
    });
  } catch (error) {
    logger.error('Google auth controller error', error);

    // Log failure
    await captureAudit(
      req,
      null,
      'SYSTEM',
      STATUSES.LOGIN_CRASH,
      STATUSES.UNAUTHORIZED
    );

    error.statusCode = error.statusCode || MESSAGES.HTTP_STATUS.UNAUTHORIZED;
    next(error);
  }
};

module.exports = {
  googleAuth,
};
