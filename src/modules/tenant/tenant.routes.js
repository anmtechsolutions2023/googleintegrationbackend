// src/modules/tenant/tenant.routes.js
// Tenant management routes - handles tenant switching operations.

const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../../middleware/authMiddleware');
const { auditLog } = require('../../middleware/auditLogger');
const tenantController = require('./tenant.controller');

/**
 * POST /api/tenants/switch
 * Allows authenticated users to switch their active tenant context.
 */
router.post(
  '/switch',
  authenticateToken,
  auditLog(),
  tenantController.switchTenant
);

module.exports = router;
