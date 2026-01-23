// src/modules/audit/audit.routes.js
// Audit logs routes - handles audit log retrieval and filtering.

const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../../middleware/authMiddleware');
const auditController = require('./audit.controller');

/**
 * GET /api/audit/logs
 * Retrieves audit logs for the user's tenants.
 * Admins can filter by userEmail, regular users only see their own logs.
 */
router.get('/logs', authenticateToken, auditController.getAuditLogs);

module.exports = router;
