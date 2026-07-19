// src/modules/transactiontype/transactiontype.routes.js
const express = require('express');
const router = express.Router();
const {
  authenticateToken,
  checkScope,
} = require('../../middleware/authMiddleware');
const { auditLogCrud } = require('../../middleware/auditLogger');
const { SCOPES } = require('../../config/constants');
const controller = require('./transactiontype.controller');

router.get('/', authenticateToken,
  checkScope(SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.MASTER_DATA_READ, SCOPES.MASTER_DATA_WRITE), auditLogCrud('Transaction Type'), ...controller.getAll);
router.get('/:id', authenticateToken,
  checkScope(SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.MASTER_DATA_READ, SCOPES.MASTER_DATA_WRITE), auditLogCrud('Transaction Type'), ...controller.getById);
router.post(
  '/',
  authenticateToken,
  checkScope(SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.MASTER_DATA_WRITE),
  auditLogCrud('Transaction Type'),
  ...controller.create
);
router.put(
  '/:id',
  authenticateToken,
  checkScope(SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.MASTER_DATA_WRITE),
  auditLogCrud('Transaction Type'),
  ...controller.update
);
router.delete(
  '/:id',
  authenticateToken,
  checkScope(SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.MASTER_DATA_WRITE),
  auditLogCrud('Transaction Type'),
  ...controller.deleteById
);

module.exports = router;
