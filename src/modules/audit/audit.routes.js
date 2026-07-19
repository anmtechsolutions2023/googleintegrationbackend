// src/modules/audit/audit.routes.js

const express = require('express');
const router = express.Router();
const { authenticateToken, checkScope } = require('../../middleware/authMiddleware');
const { SCOPES } = require('../../config/constants');
const auditController = require('./audit.controller');

// Audit logs are viewable by users granted AUDIT:READ (e.g. read-only business
// roles) as well as IAM admins (admin:access, who retain access).
const auditRead = checkScope(SCOPES.AUDIT_READ, SCOPES.ADMIN_ACCESS);

// GET /api/audit/logs  — tier-aware log retrieval
router.get('/logs', authenticateToken, auditRead, auditController.getAuditLogs);

// GET /api/audit/categories  — valid category list for filter dropdowns
router.get('/categories', authenticateToken, auditRead, auditController.getCategories);

module.exports = router;
