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
const { SCOPES } = require('../../config/constants');

/**
 * GET /api/data/settings
 * Requires TENANT:ADMIN scope.
 */
router.get(
  '/settings',
  authenticateToken,
  checkScope(SCOPES.TENANT_ADMIN),
  auditLog(),
  dataController.getAdminSettings
);

/**
 * GET /api/data/general
 * Requires only authentication.
 */
router.get(
  '/general',
  authenticateToken,
  auditLog(),
  dataController.getGeneralData
);

module.exports = router;
