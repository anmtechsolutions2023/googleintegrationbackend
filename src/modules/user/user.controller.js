// src/modules/user/user.controller.js
// Controller layer for user operations.
// Handles request/response logic for logout and user profile.

const { logger } = require('../../utils/logger');
const MESSAGES = require('../../config/messages');

/**
 * Handles user logout.
 * @param {Object} req - Express request.
 * @param {Object} res - Express response.
 * @param {Function} next - Express next.
 */
const logout = async (req, res, next) => {
  try {
    logger.info('Logout request', { user: req.user.email });

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

module.exports = {
  logout,
};
