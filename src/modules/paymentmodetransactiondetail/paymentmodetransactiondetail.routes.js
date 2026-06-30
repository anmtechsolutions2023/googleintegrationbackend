// src/modules/paymentmodetransactiondetail/paymentmodetransactiondetail.routes.js
const express = require('express');
const router = express.Router();
const {
  authenticateToken,
  checkScope,
} = require('../../middleware/authMiddleware');
const { auditLogCrud } = require('../../middleware/auditLogger');
const { SCOPES } = require('../../config/constants');
const controller = require('./paymentmodetransactiondetail.controller');

router.get('/', authenticateToken, auditLogCrud('Payment Mode Transaction Detail'), ...controller.getAll);
router.get('/:id', authenticateToken, auditLogCrud('Payment Mode Transaction Detail'), ...controller.getById);
router.post(
  '/',
  authenticateToken,
  checkScope(SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.PAYMENTS_WRITE),
  auditLogCrud('Payment Mode Transaction Detail'),
  ...controller.create
);
router.put(
  '/:id',
  authenticateToken,
  checkScope(SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.PAYMENTS_WRITE),
  auditLogCrud('Payment Mode Transaction Detail'),
  ...controller.update
);
router.delete(
  '/:id',
  authenticateToken,
  checkScope(SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.PAYMENTS_WRITE),
  auditLogCrud('Payment Mode Transaction Detail'),
  ...controller.deleteById
);

module.exports = router;
