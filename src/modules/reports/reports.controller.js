// src/modules/reports/reports.controller.js
// Controller layer for reports operations.
// Handles request/response logic for reports and billing access.

const { logger } = require('../../utils/logger');
const MESSAGES = require('../../config/messages');

/**
 * Handles reports access (placeholder).
 * @param {Object} req - Express request.
 * @param {Object} res - Express response.
 */
const getReports = (req, res) => {
  logger.info('Reports access', { user: req.user.email });
  res.json({
    message: `Tenant ${req.user.tid} - ${MESSAGES.SUCCESS.REPORTS_ACCESS}`,
    resource: 'reports_data',
    user: {
      email: req.user.email,
      tenantId: req.user.tid,
      scopes: req.user.scopes,
    },
  });
};

/**
 * Handles billing access (placeholder).
 * @param {Object} req - Express request.
 * @param {Object} res - Express response.
 */
const getBilling = (req, res) => {
  logger.info('Billing access', { user: req.user.email });
  res.json({
    message: `Tenant ${req.user.tid} - ${MESSAGES.SUCCESS.BILLING_ACCESS}`,
    resource: 'billing_info',
    user: {
      email: req.user.email,
      tenantId: req.user.tid,
      scopes: req.user.scopes,
    },
  });
};

module.exports = {
  getReports,
  getBilling,
};
