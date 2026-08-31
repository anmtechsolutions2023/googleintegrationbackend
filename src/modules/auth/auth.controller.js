// src/modules/auth/auth.controller.js
// Controller layer for authentication routes.
// Handles request/response logic, input validation, and error handling for auth operations.

const Joi = require('joi');
const { logger } = require('../../utils/logger');
const MESSAGES = require('../../config/messages');
const { STATUSES, AUDIT_CATEGORIES, AUDIT_ACTIONS } = require('../../config/constants');
const { HttpError } = require('../../middleware/errorHandler');
const { captureAudit } = require('../../utils/logger');
const authService = require('./auth.service');

// Validation schemas
const googleAuthSchema = Joi.object({
  id_token: Joi.string().required(),
});

/**
 * Handles Google OAuth authentication.
 * Returns a JWT for both provisioned users (full scopes) and
 * unprovisioned users (guest:explore scope + onboarding info).
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

    const isApproved = userPermissions.onboardingStatus === 'APPROVED';

    // Log the outcome — tenantId is null for guests, captureAudit handles it
    await captureAudit(
      req,
      userPermissions.tenantId ?? null,
      userPermissions.email,
      isApproved ? AUDIT_ACTIONS.LOGIN_SUCCESS : AUDIT_ACTIONS.ONBOARDING_ATTEMPT,
      STATUSES.SUCCESS,
      AUDIT_CATEGORIES.AUTH,
      'INFO',
      userPermissions.tenantId ?? null
    );

    logger.info('Google auth successful', {
      email: userPermissions.email,
      tenantId: userPermissions.tenantId,
      onboardingStatus: userPermissions.onboardingStatus,
    });

    res.json({
      success: true,
      message: MESSAGES.SUCCESS.AUTH,
      token: appToken,
      user: {
        email: userPermissions.email,
        tenant_id: userPermissions.tenantId,
        scopes: userPermissions.permissions,
        onboarding_status: userPermissions.onboardingStatus || 'APPROVED',
      },
    });
  } catch (error) {
    logger.error('Google auth controller error', error);

    // Log failure — tenantId unknown at this point
    await captureAudit(
      req, null, 'SYSTEM',
      AUDIT_ACTIONS.LOGIN_CRASH, STATUSES.FAILED,
      AUDIT_CATEGORIES.AUTH, 'ERROR', null
    );

    // Deliberately no default status here. This catch sees Google rejections
    // (already 401 from the service) alongside database and audit failures; a
    // blanket 401 relabelled every outage as a rejected user, and the UI dutifully
    // reported "user does not exist" for a database that was simply unreachable.
    // Errors without a status fall through to the handler's 500, or its 503 for
    // an unreachable database.
    next(error);
  }
};

module.exports = {
  googleAuth,
};
