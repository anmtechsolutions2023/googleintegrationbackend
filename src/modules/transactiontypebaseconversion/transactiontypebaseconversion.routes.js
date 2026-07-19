// src/modules/transactiontypebaseconversion/transactiontypebaseconversion.routes.js
const express = require('express');
const router = express.Router();
const {
  authenticateToken,
  checkScope,
} = require('../../middleware/authMiddleware');
const { auditLogCrud } = require('../../middleware/auditLogger');
const { SCOPES } = require('../../config/constants');
const controller = require('./transactiontypebaseconversion.controller');

router.get('/', authenticateToken,
  checkScope(SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.TRANSACTIONS_READ, SCOPES.TRANSACTIONS_WRITE), auditLogCrud('Transaction Type Base Conversion'), ...controller.getAll);
router.get('/:id', authenticateToken,
  checkScope(SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.TRANSACTIONS_READ, SCOPES.TRANSACTIONS_WRITE), auditLogCrud('Transaction Type Base Conversion'), ...controller.getById);
router.post(
  '/',
  authenticateToken,
  checkScope(SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.TRANSACTIONS_WRITE),
  auditLogCrud('Transaction Type Base Conversion'),
  ...controller.create
);
router.put(
  '/:id',
  authenticateToken,
  checkScope(SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.TRANSACTIONS_WRITE),
  auditLogCrud('Transaction Type Base Conversion'),
  ...controller.update
);
router.delete(
  '/:id',
  authenticateToken,
  checkScope(SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.TRANSACTIONS_WRITE),
  auditLogCrud('Transaction Type Base Conversion'),
  ...controller.deleteById
);

module.exports = router;
