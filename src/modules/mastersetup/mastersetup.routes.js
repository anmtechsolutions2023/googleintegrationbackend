// src/modules/mastersetup/mastersetup.routes.js
// First-time master-data bootstrap — creates the whole Organization/Branch/Item
// tree in one transactional call. Restricted to tenant admins.

const express = require('express');
const router = express.Router();
const {
  authenticateToken,
  checkScope,
} = require('../../middleware/authMiddleware');
const { auditLog } = require('../../middleware/auditLogger');
const { SCOPES, AUDIT_CATEGORIES, AUDIT_ACTIONS } = require('../../config/constants');
const controller = require('./mastersetup.controller');

router.post(
  '/bootstrap',
  authenticateToken,
  checkScope(SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN),
  auditLog(AUDIT_CATEGORIES.MASTER_DATA, 'INFO', AUDIT_ACTIONS.MASTER_SETUP_COMPLETED),
  ...controller.bootstrap
);

// Whether this tenant has finished the first-time wizard. Authenticated but
// intentionally NOT scope-gated beyond that: a non-admin user who is blocked by
// the setup gate still needs to be able to see why.
router.get(
  '/status',
  authenticateToken,
  ...controller.getStatus
);

module.exports = router;
