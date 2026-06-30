// src/modules/reports/reports.routes.js
// Reports management routes - handles reports and billing data access.

const express = require('express');
const router = express.Router();
const {
  authenticateToken,
  checkScope,
} = require('../../middleware/authMiddleware');
const { auditLog } = require('../../middleware/auditLogger');
const reportsController = require('./reports.controller');
const { SCOPES, AUDIT_CATEGORIES, AUDIT_ACTIONS } = require('../../config/constants');

/**
 * GET /api/reports
 * Requires REPORTS:READ scope.
 */
router.get(
  '/',
  authenticateToken,
  checkScope(SCOPES.REPORTS_READ),
  auditLog(AUDIT_CATEGORIES.REPORTS, 'DEBUG', AUDIT_ACTIONS.VIEW_REPORTS),
  reportsController.getReports
);

/**
 * GET /api/reports/billing
 * Requires BILLING:READ or REPORTS:WRITE scope.
 */
router.get(
  '/billing',
  authenticateToken,
  checkScope(SCOPES.BILLING_READ, SCOPES.REPORTS_WRITE),
  auditLog(AUDIT_CATEGORIES.REPORTS, 'DEBUG', AUDIT_ACTIONS.VIEW_BILLING),
  reportsController.getBilling
);

module.exports = router;
