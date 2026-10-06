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

// Collecting a balance is taking money, which is the cashier's job — so it is
// offered to anyone who can take payment at the till, not only to those who may
// write to the books. Seeing what is owed follows the same reasoning.
const COLLECT = [...WRITE, SCOPES.POS_BILLING_WRITE];
const DUES_READ = [...READ, SCOPES.POS_BILLING_READ, SCOPES.POS_BILLING_WRITE];
// Giving money up is a management decision. Admins only.
const WRITE_OFF = [SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN];
// Money going back out — a full refund, a partial return, and marking a refund
// paid. These used to need only TRANSACTIONS:WRITE, which editors and
// operations staff hold to keep the books and the numbering; neither job should
// be able to hand money back. REFUND:APPROVE is granted on purpose, by role.
const REFUND = [SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.REFUND_APPROVE];

// ── Reports ──────────────────────────────────────────────────────────────────
// Declared BEFORE /documents/:id so no report path can be swallowed by the id
// route. Read-only aggregates over the same documents, gated on the same scopes.
router.get('/reports/overview', authenticateToken, checkScope(...READ), ...controller.overviewReport);
router.get('/reports/sales', authenticateToken, checkScope(...READ), ...controller.salesReport);
router.get('/reports/products', authenticateToken, checkScope(...READ), ...controller.productReport);
// Which options and add-ons sell, on which dishes, and how often they are taken.
router.get('/reports/options', authenticateToken, checkScope(...READ), ...controller.optionsReport);
router.get('/reports/pending', authenticateToken, checkScope(...READ), ...controller.pendingReport);
router.get('/reports/tenders', authenticateToken, checkScope(...READ), ...controller.tenderReport);
router.get('/reports/cashflow', authenticateToken, checkScope(...READ), ...controller.cashFlowReport);
router.get('/reports/expenses', authenticateToken, checkScope(...READ), ...controller.expenseReport);
router.get('/reports/venue', authenticateToken, checkScope(...READ), ...controller.venueReport);
// Revenue by sales channel — dine-in / counter / delivery.
router.get('/reports/channels', authenticateToken, checkScope(...READ), ...controller.channelReport);
router.get('/reports/discounts', authenticateToken, checkScope(...READ), ...controller.discountReport);
// Balances given up on — the register behind Dues › Written off and Finance's
// Written off tab. Books readers and admins only, unlike Dues itself: a cashier
// who can collect a balance has no need for write-off totals or who made them.
router.get('/reports/write-offs', authenticateToken, checkScope(...READ), ...controller.writeOffReport);
// ── Returns ────────────────────────────────────────────────────────────────
// "Which dishes come back, and why" — unanswerable before returns were their
// own documents, because nothing recorded WHICH items were refunded.
router.get('/reports/return-reasons', authenticateToken, checkScope(...READ), ...controller.returnReasonsReport);
router.get('/reports/return-products', authenticateToken, checkScope(...READ), ...controller.returnProductReport);
// Money owed but not yet handed back — the operational worklist.
router.get('/returns/settlement-queue', authenticateToken, checkScope(...READ), ...controller.settlementQueue);
/**
 * GET /returns — the returns register.
 *
 * Declared before /returns/:id/settlement so neither swallows the other.
 * Every credit note, filterable by date, branch, reason, fault, settlement,
 * customer, item, who did it and value — because a return is a financial event
 * a business has to be able to find again months later, from whatever it
 * happens to remember.
 */
router.get('/returns', authenticateToken, checkScope(...READ), ...controller.returnsRegister);
// Customer reports — same guard as the rest. Reading who bought is reading the
// books, and a tenancy that may see its revenue may see whose revenue it was.
router.get('/reports/customers', authenticateToken, checkScope(...READ), ...controller.customerReport);
router.get('/reports/visit-pattern', authenticateToken, checkScope(...READ), ...controller.visitPatternReport);
router.get('/reports/lapsed', authenticateToken, checkScope(...READ), ...controller.lapsedReport);

/** Every sale still owed money, oldest first, with a summary over all of them. */
router.get('/dues', authenticateToken, checkScope(...DUES_READ), ...controller.dues);

router.get('/documents', authenticateToken, checkScope(...READ), ...controller.list);
router.get('/documents/:id', authenticateToken, checkScope(...READ), ...controller.getOne);
router.post(
  '/documents/:id/refund',
  authenticateToken,
  checkScope(...REFUND),
  auditLog(AUDIT_CATEGORIES.PAYMENTS, 'WARN', 'Ledger document refunded'),
  ...controller.refund,
);

/**
 * POST /documents/:id/returns — a PARTIAL return.
 *
 * Same authority as a full refund (REFUND:APPROVE): a return owes the customer
 * money back. Audited at WARN like the full refund, because who refunds what
 * and how often is the standard shrinkage control and the audit rows are what
 * answer it.
 */
router.post(
  '/documents/:id/returns',
  authenticateToken,
  checkScope(...REFUND),
  auditLog(AUDIT_CATEGORIES.PAYMENTS, 'WARN', 'Partial return recorded'),
  ...controller.createReturn,
);

/**
 * POST /documents/:id/payments — collect (part of) what a sale still owes.
 * Settles the invoice when the balance reaches ₹0.
 */
router.post(
  '/documents/:id/payments',
  authenticateToken,
  checkScope(...COLLECT),
  auditLog(AUDIT_CATEGORIES.PAYMENTS, 'INFO', 'Balance collected'),
  ...controller.collect,
);

/** POST /documents/:id/write-off — give up on the balance and close the sale. */
router.post(
  '/documents/:id/write-off',
  authenticateToken,
  checkScope(...WRITE_OFF),
  auditLog(AUDIT_CATEGORIES.PAYMENTS, 'WARN', 'Balance written off'),
  ...controller.writeOff,
);

/** PUT /documents/:id/debtor — name who owes a balance saved without one. */
router.put(
  '/documents/:id/debtor',
  authenticateToken,
  checkScope(...COLLECT),
  auditLog(AUDIT_CATEGORIES.PAYMENTS, 'INFO', 'Debtor name added'),
  ...controller.setDebtor,
);

/** Every credit note against one sale — the detail drawer's linked documents. */
router.get('/documents/:id/returns', authenticateToken, checkScope(...READ), ...controller.listReturns);

/** Mark a refund as actually paid out. A human today, a gateway later. */
router.put(
  '/returns/:id/settlement',
  authenticateToken,
  checkScope(...REFUND),
  auditLog(AUDIT_CATEGORIES.PAYMENTS, 'WARN', 'Refund settlement updated'),
  ...controller.setSettlement,
);

module.exports = router;
