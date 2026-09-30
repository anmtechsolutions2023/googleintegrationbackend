// src/modules/posqr/posqr.routes.js
// Staff side of QR table ordering, mounted at /api/pos/qr.
//
// Every route is behind authenticateToken and a named scope set from
// config/constants.js SCOPE_SETS, so who may do what is stated once:
//   POS_QR_CODES_READ   — list / print the table codes, read the branch switch
//   POS_QR_MANAGE       — rotate a code, switch the feature, change the mode
//   POS_QR_ORDER_READ   — see the queue of orders guests placed
//   POS_QR_ORDER_DECIDE — accept (fires the KOT) or reject one
// The scopes are feature rows (POS_QR:READ / POS_QR:WRITE), granted through
// roles, so an invited user receives them with the role they are invited into.
// Every route is audit-logged under AUDIT_CATEGORIES.POS.

const express = require('express');
const { authenticateToken, checkScope } = require('../../middleware/authMiddleware');
const { auditLogCrud } = require('../../middleware/auditLogger');
const { SCOPE_SETS, AUDIT_CATEGORIES } = require('../../config/constants');
const controller = require('./posqr.controller');

const router = express.Router();

const CODES_READ = checkScope(...SCOPE_SETS.POS_QR_CODES_READ);
const MANAGE = checkScope(...SCOPE_SETS.POS_QR_MANAGE);
const ORDER_READ = checkScope(...SCOPE_SETS.POS_QR_ORDER_READ);
const ORDER_DECIDE = checkScope(...SCOPE_SETS.POS_QR_ORDER_DECIDE);

const auditCodes = auditLogCrud('POS QR Code', AUDIT_CATEGORIES.POS);
// Rotating a code, switching the feature and deciding an order all change what
// a guest can do, so they are recorded at WARN.
const auditCodesChange = auditLogCrud('POS QR Code', AUDIT_CATEGORIES.POS, 'WARN');
const auditSettings = auditLogCrud('POS QR Settings', AUDIT_CATEGORIES.POS, 'WARN');
const auditOrders = auditLogCrud('POS QR Order', AUDIT_CATEGORIES.POS);
const auditDecision = auditLogCrud('POS QR Order Decision', AUDIT_CATEGORIES.POS, 'WARN');

/** GET /codes?branchId= — every table's code, issuing missing ones. */
router.get('/codes', authenticateToken, CODES_READ, auditCodes, ...controller.listCodes);

/** POST /codes/:tableId/rotate — new token; the old printed card stops working. */
router.post('/codes/:tableId/rotate', authenticateToken, MANAGE, auditCodesChange, ...controller.rotateCode);

/** GET /settings?branchId= — is QR ordering on here, and in which mode. */
router.get('/settings', authenticateToken, CODES_READ, auditCodes, ...controller.getSettings);

/** PUT /settings?branchId= — switch it on/off or change the mode. */
router.put('/settings', authenticateToken, MANAGE, auditSettings, ...controller.updateSettings);

/** GET /limits — diner code limits (read-only) and today's usage. */
router.get('/limits', authenticateToken, CODES_READ, auditCodes, ...controller.getLimits);

/** GET /orders/pending?branchId= — rounds guests placed that await a decision. */
router.get('/orders/pending', authenticateToken, ORDER_READ, auditOrders, ...controller.listPending);

/** GET /rejection-reasons — the house reasons a rejection may give. */
router.get('/rejection-reasons', authenticateToken, ORDER_READ, auditOrders, ...controller.listRejectionReasons);

/** POST /orders/:id/accept — fire the KOT for a guest's round. */
router.post('/orders/:id/accept', authenticateToken, ORDER_DECIDE, auditDecision, ...controller.acceptOrder);

/** POST /orders/:id/reject — cancel it with a reason the guest will see. */
router.post('/orders/:id/reject', authenticateToken, ORDER_DECIDE, auditDecision, ...controller.rejectOrder);

module.exports = router;
