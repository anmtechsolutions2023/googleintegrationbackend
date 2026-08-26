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

// ── Reports ──────────────────────────────────────────────────────────────────
// Declared BEFORE /documents/:id so no report path can be swallowed by the id
// route. Read-only aggregates over the same documents, gated on the same scopes.
router.get('/reports/overview', authenticateToken, checkScope(...READ), ...controller.overviewReport);
router.get('/reports/sales', authenticateToken, checkScope(...READ), ...controller.salesReport);
router.get('/reports/products', authenticateToken, checkScope(...READ), ...controller.productReport);
router.get('/reports/pending', authenticateToken, checkScope(...READ), ...controller.pendingReport);
router.get('/reports/tenders', authenticateToken, checkScope(...READ), ...controller.tenderReport);
router.get('/reports/cashflow', authenticateToken, checkScope(...READ), ...controller.cashFlowReport);
router.get('/reports/expenses', authenticateToken, checkScope(...READ), ...controller.expenseReport);
router.get('/reports/venue', authenticateToken, checkScope(...READ), ...controller.venueReport);
// Revenue by sales channel — dine-in / counter / delivery.
router.get('/reports/channels', authenticateToken, checkScope(...READ), ...controller.channelReport);
router.get('/reports/discounts', authenticateToken, checkScope(...READ), ...controller.discountReport);
// Customer reports — same guard as the rest. Reading who bought is reading the
// books, and a tenancy that may see its revenue may see whose revenue it was.
router.get('/reports/customers', authenticateToken, checkScope(...READ), ...controller.customerReport);
router.get('/reports/visit-pattern', authenticateToken, checkScope(...READ), ...controller.visitPatternReport);
router.get('/reports/lapsed', authenticateToken, checkScope(...READ), ...controller.lapsedReport);

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
