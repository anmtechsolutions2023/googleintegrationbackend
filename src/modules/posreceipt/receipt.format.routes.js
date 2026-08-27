// src/modules/posreceipt/receipt.format.routes.js
//
// What prints on paper, per branch.
//
// READS are open to every scope that can operate a till: the Print button on
// Billing and on the Ledger has to know the format, and a cashier holds neither
// POS_CONFIG:READ nor TRANSACTIONS:READ. Gating the read on config scopes would
// mean the person actually pressing Print could not fetch it.
//
// WRITES are POS_CONFIG:WRITE. Changing what appears on a customer's bill is
// the same kind of act as editing the menu — configuration, not operations —
// and the legal fields it governs make it an administrator's decision.

const express = require('express');
const router = express.Router();
const { authenticateToken, checkScope } = require('../../middleware/authMiddleware');
const { auditLog } = require('../../middleware/auditLogger');
const { SCOPES, SCOPE_SETS, AUDIT_CATEGORIES } = require('../../config/constants');
const controller = require('./receipt.format.controller');

// A till has to read the format to print. Same reasoning as the POS reference
// reads: a read follows the capability that needs it, not the module that owns it.
const readAccess = checkScope(...SCOPE_SETS.POS_REFERENCE_READ);
const writeAccess = checkScope(
  SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.POS_CONFIG_WRITE,
);

/** GET /?branchId= — every document's resolved settings, for the renderer. */
router.get('/', authenticateToken, readAccess, ...controller.getResolved);

/** GET /schema?branchId=&doc= — one document's editable fields, for the editor. */
router.get('/schema', authenticateToken, readAccess, ...controller.getSchema);

/** PUT /?branchId=&doc= — save one document's settings. */
router.put('/', authenticateToken, writeAccess,
  auditLog(AUDIT_CATEGORIES.POS, 'INFO', 'Receipt format updated'), ...controller.update);

/**
 * PUT /tax-mode?branchId= — the MODE that decides what the other settings may be.
 *
 * Its own route because it changes which fields are locked. Folding it into the
 * document save would let one request flip the mode and a now-locked field
 * together, with the outcome depending on key order.
 */
router.put('/tax-mode', authenticateToken, writeAccess,
  auditLog(AUDIT_CATEGORIES.POS, 'WARN', 'Receipt tax mode changed'), ...controller.setTaxMode);

module.exports = router;
