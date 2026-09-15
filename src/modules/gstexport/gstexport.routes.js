// src/modules/gstexport/gstexport.routes.js
// GST returns. Same scopes as the ledger they read: anyone trusted with the
// transaction record can export it. Every download is audit-logged — the pack
// is the business's whole month of sales leaving the building.

const express = require('express');
const router = express.Router();
const { authenticateToken, checkScope } = require('../../middleware/authMiddleware');
const { auditLog } = require('../../middleware/auditLogger');
const { SCOPES, AUDIT_CATEGORIES } = require('../../config/constants');
const controller = require('./gstexport.controller');

const READ = checkScope(
  SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN,
  SCOPES.TRANSACTIONS_READ, SCOPES.TRANSACTIONS_WRITE,
);
const WRITE = checkScope(SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.TRANSACTIONS_WRITE);

/** GET /split?preset=… — sales with and without GST. */
router.get('/split', authenticateToken, READ, ...controller.split);

/** GET /readiness?period=YYYY-MM&branchId= — checks and totals before download. */
router.get('/readiness', authenticateToken, READ, ...controller.readiness);

/** GET /pack?period=YYYY-MM&branchId= — the CA pack (.zip). */
router.get('/pack', authenticateToken, READ,
  auditLog(AUDIT_CATEGORIES.POS, 'INFO', 'GST export pack downloaded'), ...controller.pack);

/** GET /without-gst?fromDate=&toDate=&branchId= — sales issued without GST (.csv). */
router.get('/without-gst', authenticateToken, READ,
  auditLog(AUDIT_CATEGORIES.POS, 'INFO', 'Sales without GST exported'), ...controller.withoutGst);

/** POST /filings — { period, branchId, filedOn } */
router.post('/filings', authenticateToken, WRITE,
  auditLog(AUDIT_CATEGORIES.POS, 'WARN', 'GST filing recorded'), ...controller.recordFiling);

module.exports = router;
