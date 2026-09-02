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

/**
 * GET /api/user/capabilities
 *
 * The caller's own access, described. Authenticated only and deliberately not
 * scoped: it reads scopes off the verified token, exposes nothing about anybody
 * else, and the users who most need their access explained — somebody waiting
 * in the Approvals queue, a new cashier — are precisely the ones holding the
 * fewest scopes to gate it on.
 */
router.get('/capabilities', authenticateToken,
  auditLog(AUDIT_CATEGORIES.GENERAL, 'DEBUG', 'Viewed own capabilities'),
  ...userController.capabilities);

module.exports = router;
