// src/modules/audit/audit.routes.js

const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../../middleware/authMiddleware');
const auditController = require('./audit.controller');

// GET /api/audit/logs  — tier-aware log retrieval
router.get('/logs', authenticateToken, auditController.getAuditLogs);

// GET /api/audit/categories  — valid category list for filter dropdowns
router.get('/categories', authenticateToken, auditController.getCategories);

module.exports = router;
