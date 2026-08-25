// src/modules/paymentmode/paymentmode.routes.js
const express = require('express');
const router = express.Router();
const {
  authenticateToken,
  checkScope,
} = require('../../middleware/authMiddleware');
const { auditLogCrud } = require('../../middleware/auditLogger');
const { SCOPES } = require('../../config/constants');
const controller = require('./paymentmode.controller');

// A till cannot take money without knowing the tender types, so reading this
// list is part of billing, not a master-data privilege. Admitting the POS read
// scopes here is what lets a cashier keep a tight role: the alternative is
// granting them MASTER_DATA:READ, which hands them the entire Master Data
// section to reach one dropdown. Same reasoning as /api/pricing/quote and
// /api/pos/branches, which already do this.
//
// WRITE stays with master data — deciding which tenders the business accepts is
// a configuration decision, not a counter one.
const READ = [
  SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN,
  SCOPES.MASTER_DATA_READ, SCOPES.MASTER_DATA_WRITE,
  SCOPES.POS_BILLING_READ, SCOPES.POS_BILLING_WRITE,
  SCOPES.POS_ORDER_READ, SCOPES.POS_ORDER_WRITE,
  SCOPES.POS_OPS_READ, SCOPES.POS_OPS_WRITE,
];

router.get('/', authenticateToken,
  checkScope(...READ), auditLogCrud('Payment Mode'), ...controller.getAll);
router.get('/:id', authenticateToken,
  checkScope(...READ), auditLogCrud('Payment Mode'), ...controller.getById);
router.post(
  '/',
  authenticateToken,
  checkScope(SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.MASTER_DATA_WRITE),
  auditLogCrud('Payment Mode'),
  ...controller.create
);
router.put(
  '/:id',
  authenticateToken,
  checkScope(SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.MASTER_DATA_WRITE),
  auditLogCrud('Payment Mode'),
  ...controller.update
);
router.delete(
  '/:id',
  authenticateToken,
  checkScope(SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.MASTER_DATA_WRITE),
  auditLogCrud('Payment Mode'),
  ...controller.deleteById
);

module.exports = router;
