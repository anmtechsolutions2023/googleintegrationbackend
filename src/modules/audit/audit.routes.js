// src/modules/audit/audit.routes.js

const express = require('express');
const router = express.Router();
const { authenticateToken, checkScope } = require('../../middleware/authMiddleware');
const { SCOPES } = require('../../config/constants');
const auditController = require('./audit.controller');

// Audit logs are sensitive — restricted to IAM admins (admin:access).
const adminAccess = checkScope(SCOPES.ADMIN_ACCESS);

// GET /api/audit/logs  — tier-aware log retrieval
router.get('/logs', authenticateToken, adminAccess, auditController.getAuditLogs);

// GET /api/audit/categories  — valid category list for filter dropdowns
router.get('/categories', authenticateToken, adminAccess, auditController.getCategories);

module.exports = router;
