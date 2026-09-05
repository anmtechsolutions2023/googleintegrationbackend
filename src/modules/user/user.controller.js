// src/modules/user/user.controller.js
// Controller layer for user operations.
// Handles request/response logic for logout and user profile.

const { logger } = require('../../utils/logger');
const MESSAGES = require('../../config/messages');
const { successResponse } = require('../../utils/responseHelper');
const { asyncHandler } = require('../../utils/controllerHelper');
const capability = require('./capability.service');

/**
 * Handles user logout.
 * @param {Object} req - Express request.
 * @param {Object} res - Express response.
 * @param {Function} next - Express next.
 */
const logout = async (req, res, next) => {
  try {
    logger.info('Logout request', { user: req.user.phone });

    // Client-side should remove JWT
    // Server-side: future implementation (token blacklist, etc.)

    res.json({
      success: true,
      message: MESSAGES.SUCCESS.LOGOUT,
    });
  } catch (error) {
    logger.error('Logout controller error', error);
    next(error);
  }
};

/**
 * What the signed-in user can do, in words.
 *
 * Reads the caller's OWN scopes off the verified token — there is no parameter
 * to tamper with, so this needs no scope of its own beyond being signed in.
 * Gating it would be self-defeating: the people least able to guess what their
 * access means are the ones with the least of it.
 */
const capabilities = [
  asyncHandler(async (req, res) => {
    const data = await capability.resolveForScopes(req.user?.scopes || []);
    successResponse(res, 'Capabilities retrieved', data);
  }),
];

module.exports = {
  logout,
  capabilities,
};
