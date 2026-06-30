// src/modules/itemdetail/itemdetail.routes.js
const express = require('express');
const router = express.Router();
const {
  authenticateToken,
  checkScope,
} = require('../../middleware/authMiddleware');
const { auditLogCrud } = require('../../middleware/auditLogger');
const { SCOPES } = require('../../config/constants');
const controller = require('./itemdetail.controller');

router.get('/', authenticateToken, auditLogCrud('Item Detail'), ...controller.getAll);
router.get('/:id', authenticateToken, auditLogCrud('Item Detail'), ...controller.getById);
router.post(
  '/',
  authenticateToken,
  checkScope(SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.INVENTORY_WRITE),
  auditLogCrud('Item Detail'),
  ...controller.create
);
router.put(
  '/:id',
  authenticateToken,
  checkScope(SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.INVENTORY_WRITE),
  auditLogCrud('Item Detail'),
  ...controller.update
);
router.delete(
  '/:id',
  authenticateToken,
  checkScope(SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.INVENTORY_WRITE),
  auditLogCrud('Item Detail'),
  ...controller.deleteById
);

module.exports = router;
