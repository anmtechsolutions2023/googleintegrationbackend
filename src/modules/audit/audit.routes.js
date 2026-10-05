// src/modules/audit/audit.routes.js

const express = require('express');
const router = express.Router();
const { authenticateToken, checkScope } = require('../../middleware/authMiddleware');
const { SCOPES } = require('../../config/constants');
const auditController = require('./audit.controller');

// Audit logs are viewable by anyone granted AUDIT:READ through a role, and by
// tenant admins. Both see their own tenancy's whole trail and nothing beyond it
// (the controller pins the tenancy to the token); only a super admin reaches
// across tenancies.
const auditRead = checkScope(
  SCOPES.AUDIT_READ, SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN,
);

// GET /api/audit/logs  — tier-aware log retrieval
router.get('/logs', authenticateToken, auditRead, auditController.getAuditLogs);

// GET /api/audit/categories  — valid category list for filter dropdowns
router.get('/categories', authenticateToken, auditRead, auditController.getCategories);

module.exports = router;
