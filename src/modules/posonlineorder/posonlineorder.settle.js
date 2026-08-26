// src/modules/posonlineorder/posonlineorder.settle.js
// Where aggregator revenue becomes accounting.
//
// ── The one decision this file makes ────────────────────────────────────────
// It raises a bill against the accepted order and settles it through the
// EXISTING posbill.settle → ledger.postSaleFromBill path, rather than posting
// to the ledger itself.
//
// That choice is the reason online revenue shows up in Reports, the Ledger, the
// daily cash session and the customer's history with none of those modules
// being edited. The alternative — a second posting routine for portal orders —
// would have to re-implement rounding, tax, document numbering and status
// transitions, and would drift from the original the first time either changed.
// So this module is deliberately thin: it decides WHEN and against WHICH TENDER,
// and delegates everything about HOW.
//
// ── Why the tender matters ──────────────────────────────────────────────────
// An aggregator has already taken the customer's money; it owes us the balance
// less commission, weeks later. Settling that as Cash would put money in a till
// that never saw it and break the cash session. So each portal names its own
// SettlementPaymentModeId — a tender mapped to a RECEIVABLE account — and the
// commission posts separately as an expense.

const { withConnection } = require('../../utils/dbHelper');
const { QUERIES } = require('../../config/constants');
const MESSAGES = require('../../config/messages');
const { HttpError } = require('../../middleware/errorHandler');
const { logger } = require('../../utils/logger');
const billService = require('../posbill/posbill.service');

/**
 * The bill already raised for this order, if there is one.
 *
 * The idempotency guard for the whole file: settling twice would issue two
 * invoices for one meal. Cheap to check and the consequence of not checking is
 * a duplicated document in the ledger that has to be reversed by hand.
 */
const findExistingBill = async (conn, orderId, tenantId) => {
  const [rows] = await conn.execute(
    'SELECT b.Id, b.BillNo, b.Status, b.TransactionDetailLogId FROM pos_bill b '
    + 'JOIN pos_bill_order bo ON bo.BillId = b.Id AND bo.TenantId = b.TenantId '
    + 'WHERE bo.OrderId = ? AND b.TenantId = ? LIMIT 1',
    [orderId, tenantId],
  );
  return rows.length ? rows[0] : null;
};

/**
 * The tender an accepted portal order settles against.
 *
 * Refuses rather than guessing. Falling back to the first payment mode on file
 * would silently book aggregator money as cash, and the error would only
 * surface weeks later as a cash drawer that never reconciles — by which point
 * hundreds of documents are wrong. An explicit configuration error today is far
 * cheaper.
 */
const resolveTender = (portal) => {
  if (!portal?.SettlementPaymentModeId) {
    throw new HttpError(
      `${portal?.Name || 'This portal'} has no settlement payment mode configured. `
      + 'Set one on the Portals screen so its orders book to a receivable rather than to cash.',
      MESSAGES.HTTP_STATUS.CONFLICT,
    );
  }
  return portal.SettlementPaymentModeId;
};

/**
 * Raise and settle the bill for a delivered portal order.
 *
 * Deliberately NOT inside the caller's transaction: posbill.settle owns its own
 * transaction, and it does a great deal more than write a row — it posts a
 * ledger document, records the visit and earns loyalty. Nesting it would either
 * need it rewritten to accept a connection, or hold a transaction open across
 * all of that. Instead this runs after the status change has committed and is
 * idempotent, so a retry converges.
 *
 * @param {Object} onlineOrder - The pos_online_order row (with portal columns joined).
 * @returns {Promise<Object|null>} Settlement result, or null when there is nothing to settle.
 */
const settleForOrder = async (onlineOrder, tenantId, userEmail) => {
  if (!onlineOrder?.OrderId) {
    // Never accepted, so no pos_order exists. Nothing to bill — and that is a
    // legitimate state (a rejected order), not an error.
    return null;
  }

  const existing = await withConnection((conn) =>
    findExistingBill(conn, onlineOrder.OrderId, tenantId));

  if (existing?.TransactionDetailLogId) {
    logger.info('Portal order already posted — settle skipped', {
      onlineOrderId: onlineOrder.Id, billId: existing.Id, tenantId,
    });
    return { BillId: existing.Id, BillNo: existing.BillNo, AlreadySettled: true };
  }

  const paymentModeId = resolveTender(onlineOrder);

  const bill = existing || await billService.create(
    {
      OrderIds: [onlineOrder.OrderId],
      OrderId: onlineOrder.OrderId,
      BranchDetailId: onlineOrder.BranchDetailId,
    },
    tenantId,
    userEmail,
  );

  const billId = bill.Id || bill.id;

  // The amount is the bill's own recomputed total, not the portal's gross:
  // the ledger has to balance against the document it is posting, and the
  // portal's figure includes charges (packing, delivery) that are theirs to
  // collect, not ours to recognise as sales.
  const settled = await billService.settle(
    billId,
    { Tenders: [{ paymentModeId, amount: Number(bill.Total) || 0, refNo: onlineOrder.ExternalRef || null }] },
    tenantId,
    userEmail,
  );

  logger.info('Portal order settled to the ledger', {
    onlineOrderId: onlineOrder.Id, billId, tenantId, portal: onlineOrder.PortalCode,
  });

  return {
    BillId: billId,
    BillNo: settled.BillNo || bill.BillNo,
    Payable: settled.payable,
    TransactionDetailLogId: settled.TransactionDetailLogId ?? null,
    AlreadySettled: false,
  };
};

module.exports = { settleForOrder, findExistingBill, resolveTender };
