// src/routes/protected.routes.js
// Protected routes requiring authentication and scope checks.
// Includes tenant switching, data access, logout, and audit logs.

const express = require('express')
const router = express.Router()
const {
  authenticateToken,
  checkScope,
} = require('../middleware/authMiddleware')
const { auditLog, getAuditLogs } = require('../middleware/auditLogger')
const db = require('../config/db')
const { HttpError } = require('../middleware/errorHandler')
const { logger } = require('../utils/logger')
const MESSAGES = require('../config/messages')
const { QUERIES } = require('../config/constants')

// Import service functions
const {
  switchTenantPermissions,
  generateAppToken,
} = require('../services/auth.service')
const { log } = require('winston')

/**
 * POST /api/switch-tenant
 * Allows authenticated users to switch their active tenant context.
 */
router.post('/switch-tenant', authenticateToken, async (req, res, next) => {
  const targetTenantId = JSON.parse(JSON.stringify(req.body)).tenantId
  const userEmail = req.user.email

  if (!targetTenantId) {
    return next(new HttpError(MESSAGES.ERROR.MISSING_TENANT_ID, 400))
  }

  try {
    const newPermissions = await switchTenantPermissions(
      req,
      userEmail,
      targetTenantId,
      req.user.name
    )
    const newToken = generateAppToken(newPermissions)

    res.json({
      success: true,
      message: `${MESSAGES.SUCCESS.TENANT_SWITCH}${targetTenantId}`,
      token: newToken,
    })
  } catch (error) {
    next(
      new HttpError(error.message || MESSAGES.ERROR.TENANT_SWITCH_FAILED, 403)
    )
  }
})

/**
 * GET /api/data/admin/settings
 * Requires TENANT:ADMIN scope.
 */
router.get(
  '/data/admin/settings',
  authenticateToken,
  checkScope('TENANT:ADMIN'),
  auditLog(),
  (req, res) => {
    res.json({
      message: `Tenant ${req.user.tid} - ${MESSAGES.SUCCESS.ADMIN_ACCESS}`,
      resource: 'admin_config',
      user: {
        email: req.user.email,
        tenantId: req.user.tid,
        scopes: req.user.scopes,
      },
    })
  }
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
  (req, res) => {
    res.json({
      message: `Tenant ${req.user.tid} - ${MESSAGES.SUCCESS.REPORTS_ACCESS}`,
      resource: 'reports',
      user: {
        email: req.user.email,
        tenantId: req.user.tid,
        scopes: req.user.scopes,
      },
    })
  }
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
  (req, res) => {
    res.json({
      message: `Tenant ${req.user.tid} - ${MESSAGES.SUCCESS.BILLING_ACCESS}`,
      resource: 'billing',
      user: {
        email: req.user.email,
        tenantId: req.user.tid,
        scopes: req.user.scopes,
      },
    })
  }
)

/**
 * POST /api/logout
 * Logs out the user.
 */
router.post('/logout', authenticateToken, auditLog(), (req, res) => {
  res.json({
    message: `Tenant ${req.user.tid} - ${MESSAGES.SUCCESS.LOGOUT}`,
    resource: 'logout',
    user: {
      email: req.user.email,
      tenantId: req.user.tid,
      scopes: req.user.scopes,
    },
  })
})

/**
 * GET /api/data/general
 * Requires only authentication.
 */
router.get('/data/general', authenticateToken, auditLog(), (req, res) => {
  res.json({
    message: `Tenant ${req.user.tid} - ${MESSAGES.SUCCESS.GENERAL_ACCESS}`,
    resource: 'general_info',
    user: {
      email: req.user.email,
      tenantId: req.user.tid,
      scopes: req.user.scopes,
    },
  })
})

/**
 * GET /api/audit/logs
 * Retrieves audit logs for the user's tenants.
 */
router.get('/audit/logs', authenticateToken, async (req, res, next) => {
  try {
    const [allRows] = await db.execute(QUERIES.USER_TENANTS_SELECT, [
      req.user.email,
    ])

    const adminTenants = allRows
      .filter((row) => row.tenant_id === req.user.tid && row.is_admin)
      .map((row) => row.tenant_id)

    const isAdmin = adminTenants.length > 0

    const filters = {
      tenantIds: isAdmin ? adminTenants : [req.user.tid],
      // userEmail: isAdmin ? req.query.userEmail : req.user.email,
      userEmail: isAdmin
        ? req.query.userEmail || req.user.email
        : req.user.email,
    }

    const logs = await getAuditLogs(filters)
    res.json({
      message: MESSAGES.SUCCESS.AUDIT_LOGS_RETRIEVED,
      logs,
      isAdmin,
      associatedTenants: allRows.map((row) => ({
        tenantId: row.tenant_id,
        isAdmin: row.is_admin,
      })),
    })
  } catch (error) {
    logger.error(error)
    next(new HttpError(MESSAGES.ERROR.AUDIT_LOGS_FAILED, 500))
  }
})

module.exports = router

// Endpoint: Requires the user to have the 'billing:READ' scope
router.get(
  '/data/billing',
  authenticateToken,
  checkScope('billing:READ', 'REPORTS:WRITE'),
  auditLog(),
  (req, res) => {
    res.json({
      message: `Tenant ${req.user.tid} - Read Access: Displaying billing data.`,
      resource: 'billing',
      user: {
        email: req.user.email,
        tenantId: req.user.tid,
        scopes: req.user.scopes,
      },
    })
  }
)

// Endpoint: logout
router.post('/logout', authenticateToken, auditLog(), (req, res) => {
  res.json({
    message: `Tenant ${req.user.tid}  - User logged out successfully.`,
    resource: 'logout',
    user: {
      email: req.user.email,
      tenantId: req.user.tid,
      scopes: req.user.scopes,
    },
  })
})

// Endpoint: Requires only authentication
router.get('/data/general', authenticateToken, auditLog(), (req, res) => {
  res.json({
    message: `Tenant ${req.user.tid} - General Access: Welcome!`,
    resource: 'general_info',
    user: {
      email: req.user.email,
      tenantId: req.user.tid,
      scopes: req.user.scopes,
    },
  })
})

// Endpoint: Get audit logs
router.get('/audit/logs', authenticateToken, async (req, res, next) => {
  try {
    const [allRows] = await db.execute(
      'SELECT tenant_id, is_admin FROM user_tenants WHERE user_email = ?',
      [req.user.email]
    )

    const adminTenants = allRows
      .filter((row) => row.tenant_id === req.user.tid && row.is_admin)
      .map((row) => row.tenant_id)

    const isAdmin = adminTenants.length > 0

    const filters = {
      tenantIds: isAdmin ? adminTenants : [req.user.tid],
      userEmail: isAdmin ? req.query.userEmail : req.user.email,
    }

    const logs = await getAuditLogs(filters)
    res.json({
      message: 'Audit logs retrieved successfully.',
      logs,
      isAdmin,
      associatedTenants: allRows.map((row) => ({
        tenantId: row.tenant_id,
        isAdmin: row.is_admin,
      })),
    })
  } catch (error) {
    console.log(error)
    next(new HttpError('Failed to retrieve audit logs.', 500))
  }
})

module.exports = router
