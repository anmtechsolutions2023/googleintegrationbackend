// src/modules/paymentbreakup/paymentbreakup.routes.js
const express = require('express');
const router = express.Router();
const {
  authenticateToken,
  checkScope,
} = require('../../middleware/authMiddleware');
const { auditLogCrud } = require('../../middleware/auditLogger');
const { SCOPES } = require('../../config/constants');
const controller = require('./paymentbreakup.controller');

router.get('/', authenticateToken, auditLogCrud('Payment Breakup'), ...controller.getAll);
router.get('/:id', authenticateToken, auditLogCrud('Payment Breakup'), ...controller.getById);
router.post(
  '/',
  authenticateToken,
  checkScope(SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.PAYMENTS_WRITE),
  auditLogCrud('Payment Breakup'),
  ...controller.create
);
router.put(
  '/:id',
  authenticateToken,
  checkScope(SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.PAYMENTS_WRITE),
  auditLogCrud('Payment Breakup'),
  ...controller.update
);
router.delete(
  '/:id',
  authenticateToken,
  checkScope(SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.PAYMENTS_WRITE),
  auditLogCrud('Payment Breakup'),
  ...controller.deleteById
);

module.exports = router;
