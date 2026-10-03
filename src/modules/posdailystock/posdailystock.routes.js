// src/modules/posdailystock/posdailystock.routes.js
//
// Today's portion counts.
//
// READS are open to every scope that can operate a till. The cashier is asked
// "is the biryani still on?" before the guest is, and gating the count behind a
// configuration scope would mean the person at the counter cannot answer. Same
// reasoning as /api/pos/payment-methods and the receipt format.
//
// WRITES are POS_CONFIG:WRITE or POS_OPS:WRITE — setting the morning's numbers
// is an operations act, done by whoever runs the kitchen's day, not a
// master-data one.
//
// BOTH VERBS AUDITED, the write at WARN: "who set the biryani to four" is asked
// precisely when a service has gone wrong, and it is rare enough that WARN stays
// signal rather than noise.

const express = require('express');
const router = express.Router();
const { authenticateToken, checkScope } = require('../../middleware/authMiddleware');
const { auditLog } = require('../../middleware/auditLogger');
const { SCOPES, SCOPE_SETS, AUDIT_CATEGORIES } = require('../../config/constants');
const controller = require('./posdailystock.controller');

const readAccess = checkScope(...SCOPE_SETS.POS_REFERENCE_READ);
const writeAccess = checkScope(
  SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN,
  SCOPES.POS_CONFIG_WRITE, SCOPES.POS_OPS_WRITE,
);

/** GET /?branchId=&date= — every tracked dish, with today's count or without. */
router.get('/', authenticateToken, readAccess,
  auditLog(AUDIT_CATEGORIES.POS, 'INFO', 'Viewed daily stock'),
  ...controller.list);

/** PUT /?branchId= — { itemMetaId, preparedQty, date? }. Upsert. */
router.put('/', authenticateToken, writeAccess,
  auditLog(AUDIT_CATEGORIES.POS, 'WARN', 'Daily stock set'),
  ...controller.set);

/** DELETE /:itemMetaId?branchId=&date= — back to not-available-today. */
router.delete('/:itemMetaId', authenticateToken, writeAccess,
  auditLog(AUDIT_CATEGORIES.POS, 'WARN', 'Daily stock cleared'),
  ...controller.clear);

module.exports = router;
