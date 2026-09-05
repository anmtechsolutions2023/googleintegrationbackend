// src/modules/auth/auth.controller.js
// Sign-in by WhatsApp one-time code.
//
// Two steps, deliberately: asking for a code and spending it are separate
// requests because they fail for completely different reasons and cost
// completely different things. Collapsing them would make "we could not reach
// your phone" and "that code is wrong" the same response.
//
// The verify step returns EXACTLY the body the Google route used to, so the
// front end stores the session the same way and every redirect rule — guest,
// setup-pending, approved — keeps working unchanged.
//
// Google sign-in is gone. See WHATSAPP_IDENTITY_MIGRATION.md §1.

const Joi = require('joi');
const { logger } = require('../../utils/logger');
const MESSAGES = require('../../config/messages');
const { STATUSES, AUDIT_CATEGORIES, AUDIT_ACTIONS } = require('../../config/constants');
const { HttpError } = require('../../middleware/errorHandler');
const { captureAudit } = require('../../utils/logger');
const { maskForLog } = require('../../utils/phone');
const { phoneField } = require('../../utils/phoneSchema');
const authService = require('./auth.service');
const otpService = require('./otp.service');

const requestSchema = Joi.object({
  phone: phoneField().required(),
  // SIGNUP is how a business with no membership yet gets into the approval
  // queue. It is the one path that sends to a number nobody has vouched for,
  // which is why the daily cap matters more here than anywhere else.
  purpose: Joi.string().valid(otpService.PURPOSE.LOGIN, otpService.PURPOSE.SIGNUP)
    .default(otpService.PURPOSE.LOGIN),
});

const verifySchema = Joi.object({
  challengeId: Joi.string().required(),
  code: Joi.string().pattern(/^\d{4,8}$/).required().messages({
    'string.pattern.base': MESSAGES.ERROR.OTP_INVALID,
  }),
  // Only read when the verified number turns out to be new, and an onboarding
  // request has to be raised for it. Ignored otherwise.
  name: Joi.string().max(255).optional().trim(),
});

const validate = (schema, body) => {
  const { error, value } = schema.validate(body);
  if (error) {
    throw new HttpError(
      error.details[0].message,
      MESSAGES.HTTP_STATUS.BAD_REQUEST,
    );
  }
  return value;
};

/**
 * POST /api/auth/otp/request — send a code.
 *
 * Answers identically whether or not the number is registered: same shape,
 * same challenge id, same countdown. See otp.service for why.
 */
const requestOtp = async (req, res, next) => {
  try {
    const { phone, purpose } = validate(requestSchema, req.body);
    logger.info('OTP requested', { phone: maskForLog(phone), purpose, ip: req.ip });

    const challenge = await otpService.requestOtp({ phone, purpose, ip: req.ip });

    return res.status(MESSAGES.HTTP_STATUS.OK).json({
      success: true,
      message: MESSAGES.SUCCESS?.OTP_SENT || 'If that number can receive it, a code is on its way.',
      data: challenge,
    });
  } catch (error) {
    logger.warn('OTP request failed', { error: error.message });
    return next(error);
  }
};

/**
 * POST /api/auth/otp/verify — spend the code, get a session.
 *
 * On success this rejoins the path the Google route used to take:
 * findAndGetPermissions resolves memberships (claiming any pending invitation
 * on the way) or raises an onboarding request, and generateAppToken signs the
 * result. Neither of those functions knows a code was involved.
 */
const verifyOtp = async (req, res, next) => {
  try {
    const { challengeId, code, name } = validate(verifySchema, req.body);

    const { phone } = await otpService.verifyOtp({ challengeId, code });

    const userPermissions = await authService.findAndGetPermissions(req, {
      phone,
      // Falls back to the number so a row is never written nameless; an admin
      // sees something to correct rather than a blank.
      name: name || phone,
    });
    const appToken = authService.generateAppToken(userPermissions);

    const isApproved = userPermissions.onboardingStatus === 'APPROVED'
      || !userPermissions.onboardingStatus;

    await captureAudit(
      req,
      userPermissions.tenantId ?? null,
      userPermissions.phone,
      isApproved ? AUDIT_ACTIONS.LOGIN_SUCCESS : AUDIT_ACTIONS.ONBOARDING_ATTEMPT,
      STATUSES.SUCCESS,
      AUDIT_CATEGORIES.AUTH,
      'INFO',
      userPermissions.tenantId ?? null,
    );

    logger.info('Sign-in successful', {
      phone: maskForLog(userPermissions.phone),
      tenantId: userPermissions.tenantId,
      onboardingStatus: userPermissions.onboardingStatus,
    });

    return res.status(MESSAGES.HTTP_STATUS.OK).json({
      success: true,
      message: MESSAGES.SUCCESS?.LOGIN || 'Authentication successful',
      token: appToken,
      onboardingStatus: userPermissions.onboardingStatus || 'APPROVED',
      user: {
        phone: userPermissions.phone,
        tenant_id: userPermissions.tenantId,
        scopes: userPermissions.permissions,
        onboarding_status: userPermissions.onboardingStatus || 'APPROVED',
      },
    });
  } catch (error) {
    logger.error('OTP verify failed', { error: error.message });

    await captureAudit(
      req, null, 'SYSTEM',
      AUDIT_ACTIONS.LOGIN_CRASH, STATUSES.FAILED,
      AUDIT_CATEGORIES.AUTH, 'ERROR', null,
    );

    // Deliberately no default status. This catch sees deliberate refusals from
    // otp.service (already carrying 400/410/429) alongside database failures;
    // a blanket 401 would relabel every outage as a rejected user, which is the
    // bug the Google controller carried before it.
    return next(error);
  }
};

module.exports = { requestOtp, verifyOtp };
