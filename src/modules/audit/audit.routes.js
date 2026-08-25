// src/modules/audit/audit.routes.js

const express = require('express');
const router = express.Router();
const { authenticateToken, checkScope } = require('../../middleware/authMiddleware');
const { SCOPES } = require('../../config/constants');
const auditController = require('./audit.controller');

// Audit logs are viewable by users granted AUDIT:READ (e.g. read-only business
// roles) as well as IAM admins (admin:access, who retain access).
//
// Tenant admins are admitted too. The controller ALREADY implements a
// TENANT_ADMIN visibility tier — all logs within their own tenancy and no
// further — which the guard made unreachable unless the same person also held
// AUDIT:READ through a role. A tenant admin has full access within their own
// tenancy, and the tiering below is what keeps that boundary.
const auditRead = checkScope(
  SCOPES.AUDIT_READ, SCOPES.ADMIN_ACCESS, SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN,
);

// GET /api/audit/logs  — tier-aware log retrieval
router.get('/logs', authenticateToken, auditRead, auditController.getAuditLogs);

// GET /api/audit/categories  — valid category list for filter dropdowns
router.get('/categories', authenticateToken, auditRead, auditController.getCategories);

module.exports = router;
