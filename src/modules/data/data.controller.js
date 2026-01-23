// src/modules/data/data.controller.js
// Controller layer for data access operations.
// Handles request/response logic for admin settings and general data.

const { logger } = require('../../utils/logger');
const MESSAGES = require('../../config/messages');

/**
 * Handles admin settings access (placeholder).
 * @param {Object} req - Express request.
 * @param {Object} res - Express response.
 */
const getAdminSettings = (req, res) => {
  logger.info('Admin settings access', { user: req.user.email });
  res.json({
    message: `Tenant ${req.user.tid} - ${MESSAGES.SUCCESS.ADMIN_ACCESS}`,
    resource: 'admin_config',
    user: {
      email: req.user.email,
      tenantId: req.user.tid,
      scopes: req.user.scopes,
    },
  });
};

/**
 * Handles general data access (placeholder).
 * @param {Object} req - Express request.
 * @param {Object} res - Express response.
 */
const getGeneralData = (req, res) => {
  logger.info('General data access', { user: req.user.email });
  res.json({
    message: `Tenant ${req.user.tid} - ${MESSAGES.SUCCESS.GENERAL_ACCESS}`,
    resource: 'general_info',
    user: {
      email: req.user.email,
      tenantId: req.user.tid,
      scopes: req.user.scopes,
    },
  });
};

module.exports = {
  getAdminSettings,
  getGeneralData,
};
