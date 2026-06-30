// src/modules/batchdetail/batchdetail.routes.js
const express = require('express');
const router = express.Router();
const {
  authenticateToken,
  checkScope,
} = require('../../middleware/authMiddleware');
const { auditLogCrud } = require('../../middleware/auditLogger');
const { SCOPES } = require('../../config/constants');
const controller = require('./batchdetail.controller');

router.get('/', authenticateToken, auditLogCrud('Batch Detail'), ...controller.getAll);
router.get('/:id', authenticateToken, auditLogCrud('Batch Detail'), ...controller.getById);
router.post(
  '/',
  authenticateToken,
  checkScope(SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.INVENTORY_WRITE),
  auditLogCrud('Batch Detail'),
  ...controller.create
);
router.put(
  '/:id',
  authenticateToken,
  checkScope(SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.INVENTORY_WRITE),
  auditLogCrud('Batch Detail'),
  ...controller.update
);
router.delete(
  '/:id',
  authenticateToken,
  checkScope(SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.INVENTORY_WRITE),
  auditLogCrud('Batch Detail'),
  ...controller.deleteById
);

module.exports = router;
