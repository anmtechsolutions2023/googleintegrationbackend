// src/modules/tenant/tenant.routes.js
// Tenant management routes - handles tenant switching operations.

const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../../middleware/authMiddleware');
const { auditLog } = require('../../middleware/auditLogger');
const { AUDIT_CATEGORIES, AUDIT_ACTIONS } = require('../../config/constants');
const tenantController = require('./tenant.controller');

/**
 * POST /api/tenants/switch
 * Allows authenticated users to switch their active tenant context.
 */
router.post(
  '/switch',
  authenticateToken,
  auditLog(AUDIT_CATEGORIES.TENANT_MGMT, 'INFO', AUDIT_ACTIONS.SWITCH_TENANT),
  tenantController.switchTenant
);

module.exports = router;
