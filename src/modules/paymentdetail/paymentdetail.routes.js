// src/modules/paymentdetail/paymentdetail.routes.js
const express = require('express');
const router = express.Router();
const {
  authenticateToken,
  checkScope,
} = require('../../middleware/authMiddleware');
const { auditLogCrud } = require('../../middleware/auditLogger');
const { SCOPES } = require('../../config/constants');
const controller = require('./paymentdetail.controller');

router.get('/', authenticateToken,
  checkScope(SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.PAYMENTS_READ, SCOPES.PAYMENTS_WRITE), auditLogCrud('Payment Detail'), ...controller.getAll);
router.get('/:id', authenticateToken,
  checkScope(SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.PAYMENTS_READ, SCOPES.PAYMENTS_WRITE), auditLogCrud('Payment Detail'), ...controller.getById);
router.post(
  '/',
  authenticateToken,
  checkScope(SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.PAYMENTS_WRITE),
  auditLogCrud('Payment Detail'),
  ...controller.create
);
router.put(
  '/:id',
  authenticateToken,
  checkScope(SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.PAYMENTS_WRITE),
  auditLogCrud('Payment Detail'),
  ...controller.update
);
router.delete(
  '/:id',
  authenticateToken,
  checkScope(SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.PAYMENTS_WRITE),
  auditLogCrud('Payment Detail'),
  ...controller.deleteById
);

module.exports = router;
