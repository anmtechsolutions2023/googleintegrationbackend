// src/routes/protected.routes.js (UPDATED)
const express = require('express')
const router = express.Router()
// Import the new checkScope middleware
const {
  authenticateToken,
  checkScope,
} = require('../middleware/authMiddleware')

// Endpoint: Requires the user to have the 'TENANT:ADMIN' scope
router.get(
  '/data/admin/settings',
  authenticateToken,
  checkScope('TENANT:ADMIN'),
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
router.get('/data/general', authenticateToken, (req, res) => {
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
