// src/modules/transactiontypeconversionmapper/transactiontypeconversionmapper.routes.js
const express = require('express');
const router = express.Router();
const {
  authenticateToken,
  checkScope,
} = require('../../middleware/authMiddleware');
const { auditLogCrud } = require('../../middleware/auditLogger');
const { SCOPES } = require('../../config/constants');
const controller = require('./transactiontypeconversionmapper.controller');

router.get('/', authenticateToken, auditLogCrud('Transaction Type Conversion Mapper'), ...controller.getAll);
router.get('/:id', authenticateToken, auditLogCrud('Transaction Type Conversion Mapper'), ...controller.getById);
router.post(
  '/',
  authenticateToken,
  checkScope(SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.TRANSACTIONS_WRITE),
  auditLogCrud('Transaction Type Conversion Mapper'),
  ...controller.create
);
router.put(
  '/:id',
  authenticateToken,
  checkScope(SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.TRANSACTIONS_WRITE),
  auditLogCrud('Transaction Type Conversion Mapper'),
  ...controller.update
);
router.delete(
  '/:id',
  authenticateToken,
  checkScope(SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.TRANSACTIONS_WRITE),
  auditLogCrud('Transaction Type Conversion Mapper'),
  ...controller.deleteById
);

module.exports = router;
