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

// Reports are tenant-scoped, so a tenant admin sees their own tenancy's and
// nothing else — the same convention every POS route already follows. Without
// them here the Reports menu was offered to an admin whose request the API then
// refused.
const reportsRead = checkScope(
  SCOPES.REPORTS_READ, SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN,
);

/**
 * GET /api/reports
 * Requires REPORTS:READ, or tenant administration.
 */
router.get(
  '/',
  authenticateToken,
  reportsRead,
  auditLog(AUDIT_CATEGORIES.REPORTS, 'DEBUG', AUDIT_ACTIONS.VIEW_REPORTS),
  reportsController.getReports
);

/**
 * GET /api/reports/billing
 * Requires BILLING:READ or REPORTS:WRITE scope, or tenant administration.
 */
router.get(
  '/billing',
  authenticateToken,
  checkScope(SCOPES.BILLING_READ, SCOPES.REPORTS_WRITE, SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN),
  auditLog(AUDIT_CATEGORIES.REPORTS, 'DEBUG', AUDIT_ACTIONS.VIEW_BILLING),
  reportsController.getBilling
);

module.exports = router;
