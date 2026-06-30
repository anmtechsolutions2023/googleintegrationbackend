// src/modules/user/user.routes.js
// User management routes - handles logout and user profile operations.

const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../../middleware/authMiddleware');
const { auditLog } = require('../../middleware/auditLogger');
const { AUDIT_CATEGORIES, AUDIT_ACTIONS } = require('../../config/constants');
const userController = require('./user.controller');

/**
 * POST /api/user/logout
 * Logs out the user (currently just returns success).
 */
router.post('/logout', authenticateToken, auditLog(AUDIT_CATEGORIES.GENERAL, 'INFO', AUDIT_ACTIONS.LOGOUT), userController.logout);

module.exports = router;
