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
const { SCOPES, AUDIT_CATEGORIES } = require('../../config/constants');
const controller = require('./mastersetup.controller');

router.post(
  '/bootstrap',
  authenticateToken,
  checkScope(SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN),
  auditLog(AUDIT_CATEGORIES.MASTER_DATA, 'INFO', 'Master data bootstrap'),
  ...controller.bootstrap
);

module.exports = router;
