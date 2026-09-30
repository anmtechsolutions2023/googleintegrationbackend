// src/modules/pospaymentmethod/pospaymentmethod.routes.js
//
// Which tenders an outlet accepts.
//
// READS are open to every scope that can operate a till, plus the master-data
// scopes. This is the same reasoning as paymentmodes and receipt-format: the
// person pressing Settle has to know what the counter accepts, and a cashier
// holds neither POS_CONFIG:READ nor MASTER_DATA:READ. Gating the read on a
// configuration scope would mean the till could not list its own payment buttons
// without handing every cashier the Master Data section.
//
// WRITES are POS_CONFIG:WRITE or MASTER_DATA:WRITE. Deciding which tenders an
// outlet takes is a configuration act, not a counter one — a cashier who could
// switch Card off mid-shift is a cashier who can stop the business taking cards.
//
// EVERYTHING IS AUDITED. Both verbs, because "who turned UPI off at this outlet
// and when" is a question that gets asked precisely when takings do not
// reconcile, and a read of the list is how a support call starts. The write is
// logged at WARN: it changes what a till can do, and it is rare enough that WARN
// stays signal rather than noise.

const express = require('express');
const router = express.Router();
const { authenticateToken, checkScope } = require('../../middleware/authMiddleware');
const { auditLog } = require('../../middleware/auditLogger');
const { SCOPES, SCOPE_SETS, AUDIT_CATEGORIES } = require('../../config/constants');
const controller = require('./pospaymentmethod.controller');

const readAccess = checkScope(
  ...SCOPE_SETS.POS_REFERENCE_READ,
  SCOPES.MASTER_DATA_READ, SCOPES.MASTER_DATA_WRITE,
);
const writeAccess = checkScope(
  SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN,
  SCOPES.POS_CONFIG_WRITE, SCOPES.MASTER_DATA_WRITE,
);

/** GET /?branchId= — every method, with this outlet's effective state. */
router.get('/', authenticateToken, readAccess,
  auditLog(AUDIT_CATEGORIES.PAYMENTS, 'INFO', 'Viewed outlet payment methods'),
  ...controller.list);

/**
 * PUT /?branchId= — { methods: [{ paymentModeId, enabled }] }.
 *
 * Partial lists are normal: the screen saves one switch at a time, and a method
 * this call does not name is left exactly as it was.
 */
router.put('/', authenticateToken, writeAccess,
  auditLog(AUDIT_CATEGORIES.PAYMENTS, 'WARN', 'Outlet payment methods updated'),
  ...controller.save);

module.exports = router;
