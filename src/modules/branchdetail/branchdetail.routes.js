// src/modules/branchdetail/branchdetail.routes.js
const express = require('express');
const router = express.Router();
const { authenticateToken, checkScope } = require('../../middleware/authMiddleware');
const { auditLogCrud } = require('../../middleware/auditLogger');
const { SCOPES } = require('../../config/constants');
const controller = require('./branchdetail.controller');

router.get('/', authenticateToken,
  checkScope(SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.ORGANIZATION_READ, SCOPES.ORGANIZATION_WRITE), auditLogCrud('Branch Detail'), ...controller.getAll);
router.get('/:id', authenticateToken,
  checkScope(SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.ORGANIZATION_READ, SCOPES.ORGANIZATION_WRITE), auditLogCrud('Branch Detail'), ...controller.getById);
router.post('/', authenticateToken, checkScope(SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.ORGANIZATION_WRITE), auditLogCrud('Branch Detail'), ...controller.create);
router.put('/:id', authenticateToken, checkScope(SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.ORGANIZATION_WRITE), auditLogCrud('Branch Detail'), ...controller.update);
router.delete('/:id', authenticateToken, checkScope(SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.ORGANIZATION_WRITE), auditLogCrud('Branch Detail'), ...controller.deleteById);

module.exports = router;
