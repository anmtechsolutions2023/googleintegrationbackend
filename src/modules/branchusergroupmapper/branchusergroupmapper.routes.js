// src/modules/branchusergroupmapper/branchusergroupmapper.routes.js
const express = require('express');
const router = express.Router();
const {
  authenticateToken,
  checkScope,
} = require('../../middleware/authMiddleware');
const { auditLogCrud } = require('../../middleware/auditLogger');
const { SCOPES } = require('../../config/constants');
const controller = require('./branchusergroupmapper.controller');

router.get('/', authenticateToken, auditLogCrud('Branch User Group Mapper'), ...controller.getAll);
router.get('/:id', authenticateToken, auditLogCrud('Branch User Group Mapper'), ...controller.getById);
router.post(
  '/',
  authenticateToken,
  checkScope(SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.ORGANIZATION_WRITE),
  auditLogCrud('Branch User Group Mapper'),
  ...controller.create
);
router.put(
  '/:id',
  authenticateToken,
  checkScope(SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.ORGANIZATION_WRITE),
  auditLogCrud('Branch User Group Mapper'),
  ...controller.update
);
router.delete(
  '/:id',
  authenticateToken,
  checkScope(SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.ORGANIZATION_WRITE),
  auditLogCrud('Branch User Group Mapper'),
  ...controller.deleteById
);

module.exports = router;
