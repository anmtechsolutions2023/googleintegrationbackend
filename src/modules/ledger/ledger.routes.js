// src/modules/ledger/ledger.routes.js
// Accounting ledger — read access plus whole-document reversal.
//
// Gated on TRANSACTIONS scopes rather than a new one: a ledger document IS the
// transaction record, so anyone trusted to read transactions can read it.
// Refund is a write and needs TRANSACTIONS:WRITE.

const express = require('express');
const router = express.Router();
const { authenticateToken, checkScope } = require('../../middleware/authMiddleware');
const { auditLog } = require('../../middleware/auditLogger');
const { SCOPES, AUDIT_CATEGORIES } = require('../../config/constants');
const controller = require('./ledger.controller');

const READ = [
  SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN,
  SCOPES.TRANSACTIONS_READ, SCOPES.TRANSACTIONS_WRITE,
];
const WRITE = [SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.TRANSACTIONS_WRITE];

router.get('/documents', authenticateToken, checkScope(...READ), ...controller.list);
router.get('/documents/:id', authenticateToken, checkScope(...READ), ...controller.getOne);
router.post(
  '/documents/:id/refund',
  authenticateToken,
  checkScope(...WRITE),
  auditLog(AUDIT_CATEGORIES.PAYMENTS, 'WARN', 'Ledger document refunded'),
  ...controller.refund,
);

module.exports = router;
