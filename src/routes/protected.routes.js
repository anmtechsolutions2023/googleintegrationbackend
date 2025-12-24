// src/routes/protected.routes.js
const express = require('express')
const router = express.Router()
const {
  authenticateToken,
  checkScope,
} = require('../middleware/authMiddleware')
const { auditLog, getAuditLogs } = require('../middleware/auditLogger')
const db = require('../config/db')
const { HttpError } = require('../middleware/errorHandler')

// Import the service responsible for permissions and token generation
const {
  switchTenantPermissions,
  generateAppToken,
} = require('../services/auth.service')

/**
 * Endpoint: /switch-tenant
 * Purpose: Allows a user with a valid session to switch their active tenant context.
 */
router.post(
  '/switch-tenant',
  authenticateToken, // Ensures the user is logged in
  async (req, res, next) => {
    // const { targetTenantId } = req.body

    const targetTenantId = JSON.parse(JSON.stringify(req.body)).tenantId
    const userEmail = req.user.email
    const userName = req.user.name

    if (!targetTenantId) {
      return next(new HttpError('Target Tenant ID is required.', 400))
    }

    try {
      // 1. Get new permissions and validate membership for target tenant
      const newPermissions = await switchTenantPermissions(
        req,
        userEmail,
        targetTenantId,
        userName
      )

      // 2. Generate a new JWT with the updated tenant ID and scopes
      const newToken = generateAppToken(newPermissions)

      // 3. Return the new token to the frontend
      res.json({
        success: true,
        message: `Successfully switched to tenant: ${targetTenantId}`,
        token: newToken,
      })
    } catch (error) {
      console.error('Tenant Switch Route Error:', error.message)
      // Pass the error to our global handler (will likely be a 403)
      next(new HttpError(error.message || 'Tenant switch failed', 403))
    }
  }
)

// --- EXISTING ROUTES ---

// Endpoint: Requires the user to have the 'TENANT:ADMIN' scope
router.get(
  '/data/admin/settings',
  authenticateToken,
  checkScope('TENANT:ADMIN'),
  auditLog(),
  (req, res) => {
    res.json({
      message: `Tenant ${req.user.tid} - ADMIN ACCESS: Configuration settings.`,
      resource: 'admin_config',
      user: {
        email: req.user.email,
        tenantId: req.user.tid,
        scopes: req.user.scopes,
      },
    })
  }
)

// Endpoint: Requires the user to have the 'reports:READ' scope
router.get(
  '/data/reports',
  authenticateToken,
  checkScope('REPORTS:READ'),
  auditLog(),
  (req, res) => {
    res.json({
      message: `Tenant ${req.user.tid} - Read Access: Report generation started.`,
      resource: 'reports',
      user: {
        email: req.user.email,
        tenantId: req.user.tid,
        scopes: req.user.scopes,
      },
    })
  }
)

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
