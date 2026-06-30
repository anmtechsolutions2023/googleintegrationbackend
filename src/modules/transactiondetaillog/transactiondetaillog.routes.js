// src/modules/transactiondetaillog/transactiondetaillog.routes.js
const express = require('express');
const router = express.Router();
const {
  authenticateToken,
  checkScope,
} = require('../../middleware/authMiddleware');
const { auditLogCrud } = require('../../middleware/auditLogger');
const { SCOPES } = require('../../config/constants');
const controller = require('./transactiondetaillog.controller');

router.get('/', authenticateToken, auditLogCrud('Transaction Detail Log'), ...controller.getAll);
router.get('/:id', authenticateToken, auditLogCrud('Transaction Detail Log'), ...controller.getById);
router.post(
  '/',
  authenticateToken,
  checkScope(SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.TRANSACTIONS_WRITE),
  auditLogCrud('Transaction Detail Log'),
  ...controller.create
);
router.put(
  '/:id',
  authenticateToken,
  checkScope(SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.TRANSACTIONS_WRITE),
  auditLogCrud('Transaction Detail Log'),
  ...controller.update
);
router.delete(
  '/:id',
  authenticateToken,
  checkScope(SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.TRANSACTIONS_WRITE),
  auditLogCrud('Transaction Detail Log'),
  ...controller.deleteById
);

module.exports = router;
