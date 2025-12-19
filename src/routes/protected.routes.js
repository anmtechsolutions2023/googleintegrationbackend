// src/routes/protected.routes.js (UPDATED)
const express = require('express')
const router = express.Router()
// Import the new checkScope middleware
const {
  authenticateToken,
  checkScope,
} = require('../middleware/authMiddleware')
const { auditLog, getAuditLogs } = require('../middleware/auditLogger')
const db = require('../config/db')
const { HttpError } = require('../middleware/errorHandler')

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

// Endpoint: Requires the user to have the 'reports:WRITE' scope
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
  // checkScope('REPORTS:READ', 'REPORTS:WRITE'),
  // checkScope('REPORTS:READ'),
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

// Endpoint: Requires only authentication (any user with a valid token/tenant access)
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

// Endpoint: Get audit logs (requires authentication, checks admin status internally)
router.get(
  '/audit/logs',
  authenticateToken,
  auditLog(),
  async (req, res, next) => {
    try {
      console.log('Request details:', req.user, req.query)
      // Get all tenants the user is associated with
      const [allRows] = await db.execute(
        'SELECT tenant_id, is_admin FROM user_tenants WHERE user_email = ?',
        [req.user.email]
      )

      console.log('All associated tenants:', allRows)
      console.log('Requested user email: ' + req.user.email)
      console.log('Requested tenant id: ' + req.user.tid)

      // Collect tenant IDs where user is admin
      // const adminTenants = allRows
      //   .filter((row) => row.is_admin)
      //   .map((row) => row.tenant_id)

      const adminTenants = allRows
        .filter((row) => row.tenant_id === req.user.tid && row.is_admin)
        .map((row) => row.tenant_id)

      const isAdmin = adminTenants.length > 0

      const filters = {
        tenantIds: isAdmin ? adminTenants : [req.user.tid], // If admin, logs for all admin tenants; else current tenant
        userEmail: isAdmin ? req.query.userEmail : req.user.email, // If admin, can filter by userEmail; else only their logs
        // action: req.query.action,
        // status: req.query.status,
        // limit: parseInt(req.query.limit) || 100,
        // offset: parseInt(req.query.offset) || 0,
      }

      console.log('Audit log filters:', filters)

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
  }
)

module.exports = router

// // src/routes/protected.routes.js
// const express = require('express')
// const router = express.Router()
// const {
//   authenticateToken,
//   authorizeRole,
// } = require('../middleware/authMiddleware')

// router.get(
//   '/data/admin',
//   authenticateToken,
//   authorizeRole(['admin']),
//   (req, res) => {
//     res.json({
//       message: 'ADMIN ACCESS GRANTED: Highly confidential data.',
//       resource: 'admin_panel',
//       user: req.user,
//     })
//   }
// )

// router.get(
//   '/data/editor',
//   authenticateToken,
//   authorizeRole(['admin', 'editor']),
//   (req, res) => {
//     res.json({
//       message: 'EDITOR ACCESS GRANTED: Data ready for modification.',
//       resource: 'editor_dashboard',
//       user: req.user,
//     })
//   }
// )

// router.get('/data/public', authenticateToken, (req, res) => {
//   res.json({
//     message: 'VIEWER ACCESS GRANTED: General public data.',
//     resource: 'general_info',
//     user: req.user,
//   })
// })

// module.exports = router
