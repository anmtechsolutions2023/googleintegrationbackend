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

// The column widths every input's maxLength is set from.
//
// Served rather than mirrored in the frontend on purpose. A second copy of these
// numbers is the bug this endpoint exists to prevent: the wizard accepted 200
// characters for a VARCHAR(50) column, and a mirrored constant would drift the
// same way the next time a column changes. One source, fetched at load.
//
// Authenticated but not scope-gated: these are column widths, not data. A user who
// can open the wizard must be able to learn what it will accept.
router.get('/field-limits', authenticateToken, ...controller.getFieldLimits);

module.exports = router;
