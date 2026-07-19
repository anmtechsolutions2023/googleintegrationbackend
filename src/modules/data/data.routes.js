// src/modules/data/data.routes.js
// Data access routes - handles admin settings and general data access.

const express = require('express');
const router = express.Router();
const {
  authenticateToken,
  checkScope,
} = require('../../middleware/authMiddleware');
const { auditLog } = require('../../middleware/auditLogger');
const dataController = require('./data.controller');
const { SCOPES, AUDIT_CATEGORIES, AUDIT_ACTIONS } = require('../../config/constants');

/**
 * GET /api/data/settings
 * Requires TENANT:ADMIN scope.
 */
router.get(
  '/settings',
  authenticateToken,
  checkScope(SCOPES.TENANT_ADMIN),
  auditLog(AUDIT_CATEGORIES.GENERAL, 'DEBUG', AUDIT_ACTIONS.VIEW_ADMIN_SETTINGS),
  dataController.getAdminSettings
);

/**
 * GET /api/data/general
 * Requires TENANT:ADMIN scope.
 */
router.get(
  '/general',
  authenticateToken,
  checkScope(SCOPES.TENANT_ADMIN),
  auditLog(AUDIT_CATEGORIES.GENERAL, 'DEBUG', AUDIT_ACTIONS.VIEW_GENERAL_DATA),
  dataController.getGeneralData
);

module.exports = router;
