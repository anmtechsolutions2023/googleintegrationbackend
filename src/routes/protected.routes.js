// src/routes/protected.routes.js
// Protected routes requiring authentication and scope checks.
// Thin layer that delegates to controllers.

const express = require('express')
const router = express.Router()
const {
  authenticateToken,
  checkScope,
} = require('../middleware/authMiddleware')
const { auditLog } = require('../middleware/auditLogger')
const protectedController = require('../controllers/protected.controller')

/**
 * POST /api/switch-tenant
 * Allows authenticated users to switch their active tenant context.
 */
router.post(
  '/switch-tenant',
  authenticateToken,
  protectedController.switchTenant
)

/**
 * GET /api/data/admin/settings
 * Requires TENANT:ADMIN scope.
 */
router.get(
  '/data/admin/settings',
  authenticateToken,
  checkScope('TENANT:ADMIN'),
  auditLog(),
  protectedController.getAdminSettings
)

/**
 * GET /api/data/reports
 * Requires REPORTS:READ scope.
 */
router.get(
  '/data/reports',
  authenticateToken,
  checkScope('REPORTS:READ'),
  auditLog(),
  protectedController.getReports
)

/**
 * GET /api/data/billing
 * Requires billing:READ or REPORTS:WRITE scope.
 */
router.get(
  '/data/billing',
  authenticateToken,
  checkScope('billing:READ', 'REPORTS:WRITE'),
  auditLog(),
  protectedController.getBilling
)

/**
 * POST /api/logout
 * Logs out the user.
 */
router.post(
  '/logout',
  authenticateToken,
  auditLog(),
  protectedController.logout
)

/**
 * GET /api/data/general
 * Requires only authentication.
 */
router.get(
  '/data/general',
  authenticateToken,
  auditLog(),
  protectedController.getGeneralData
)

/**
 * GET /api/audit/logs
 * Retrieves audit logs for the user's tenants.
 */
router.get('/audit/logs', authenticateToken, protectedController.getAuditLogs)

module.exports = router
