// src/routes/protected.routes.js (UPDATED)
const express = require('express')
const router = express.Router()
// Import the new checkScope middleware
const {
  authenticateToken,
  checkScope,
} = require('../middleware/authMiddleware')
const { auditLog, getAuditLogs } = require('../middleware/auditLogger')

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
router.post(
  '/data/reports',
  authenticateToken,
  checkScope('reports:WRITE'),
  auditLog(),
  (req, res) => {
    res.json({
      message: `Tenant ${req.user.tid} - Write Access: Report generation started.`,
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

// Endpoint: Get audit logs (requires TENANT:ADMIN scope)
router.get(
  '/audit/logs',
  authenticateToken,
  checkScope('TENANT:ADMIN'),
  auditLog(),
  async (req, res) => {
    try {
      const filters = {
        tenantId: req.query.tenantId || req.user.tid, // Default to user's tenant
        userEmail: req.query.userEmail,
        action: req.query.action,
        status: req.query.status,
        limit: parseInt(req.query.limit) || 100,
        offset: parseInt(req.query.offset) || 0,
      }
      const logs = await getAuditLogs(filters)
      res.json({
        message: 'Audit logs retrieved successfully.',
        logs,
      })
    } catch (error) {
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
