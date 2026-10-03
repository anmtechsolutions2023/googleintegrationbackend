// src/modules/posqr/posqr.orders.service.js
// The staff half of a QR order: see what guests placed, then accept or reject.
//
// A guest's round is created OPEN with no kitchen ticket. Nothing is cooked
// until somebody here presses Accept, which fires the KOT through the same
// send-once path the till uses (posorder.fireKot). That review is the defence
// against a photographed code being used from outside the restaurant.
// QR_TABLE_ORDERING_DESIGN.md §4.5.

const { withTransaction, withConnection } = require('../../utils/dbHelper');
const { QUERIES, QR_ORDERING } = require('../../config/constants');
const MESSAGES = require('../../config/messages');
const { HttpError } = require('../../middleware/errorHandler');
const { logger } = require('../../utils/logger');
const posOrderService = require('../posorder/posorder.service');
const { refreshTable } = require('../posorder/posorder.transfer');
const dailyStock = require('../posdailystock/posdailystock.service');

const Q = QUERIES.POS_QR_ORDER;

const parseItems = (v) => {
  if (Array.isArray(v)) return v;
  try { return JSON.parse(v || '[]'); } catch { return []; }
};

const toPending = (r) => ({
  id: r.Id,
  orderNo: r.OrderNo,
  tableId: r.TableId,
  tableName: r.TableName,
  floorName: r.FloorName,
  branchId: r.BranchDetailId,
  items: parseItems(r.Items),
  subTotal: Number(r.SubTotal) || 0,
  taxAmount: Number(r.TaxAmount) || 0,
  total: Number(r.Total) || 0,
  cookingInstructions: r.CookingInstructions || null,
  placedAt: r.CreatedOn,
  customer: r.CustomerId ? {
    id: r.CustomerId,
    name: r.CustomerName,
    phone: r.CustomerPhone,
    visits: Number(r.Visits) || 0,
    totalSpent: Number(r.TotalSpent) || 0,
    lastVisitAt: r.LastVisitAt || null,
  } : null,
});

/**
 * Rounds guests placed that nobody has decided yet, oldest first.
 * @param {string|null} branchId - null = every branch of the tenant.
 * @param {string} tenantId
 */
const listPending = (branchId, tenantId) =>
  withConnection(async (conn) => {
    const [rows] = await conn.execute(Q.SELECT_PENDING, [
      QR_ORDERING.CHANNEL.CODE, tenantId, branchId || null, branchId || null,
    ]);
    return rows.map(toPending);
  });

/** House rejection reasons — what a guest may be told. */
const listRejectionReasons = (tenantId) =>
  withConnection(async (conn) => {
    const [rows] = await conn.execute(Q.REJECTION_REASONS, [tenantId]);
    return rows.map((r) => ({ id: r.Id, name: r.Name, code: r.Code }));
  });

/**
 * Locks the round and checks it is a QR round nobody has decided yet.
 * @returns {Promise<Object>} The locked row.
 */
const lockPendingTx = async (conn, orderId, tenantId) => {
  const [rows] = await conn.execute(Q.SELECT_FOR_DECISION, [orderId, tenantId]);
  const row = rows[0];
  if (!row) throw new HttpError('POS Order not found', 404);
  if (row.ChannelCode !== QR_ORDERING.CHANNEL.CODE) {
    throw new HttpError(MESSAGES.ERROR.QR_ORDER_NOT_QR, 409);
  }
  if (String(row.Status || '').toLowerCase() !== 'open' || Number(row.LiveKots) > 0) {
    throw new HttpError(MESSAGES.ERROR.QR_ORDER_NOT_PENDING, 409);
  }
  return row;
};

/**
 * Accept: send the round to the kitchen.
 *
 * The pending check and the fire are two steps, but both are safe to race:
 * fireKot is send-once (a second call returns the existing ticket) and refuses
 * a round that has been cancelled, so an Accept racing a Reject produces
 * exactly one outcome.
 */
const accept = async (orderId, tenantId, userPhone) => {
  await withTransaction((conn) => lockPendingTx(conn, orderId, tenantId));
  const kot = await posOrderService.fireKot(orderId, {}, tenantId, userPhone);
  logger.info('QR order accepted', { tenantId, orderId, by: userPhone });
  return { orderId, kot };
};

/**
 * Reject: cancel the round with a reason the guest will see, and free the table
 * if this was its only open round.
 */
const reject = async (orderId, { reasonId, note }, tenantId, userPhone) =>
  withTransaction(async (conn) => {
    const order = await lockPendingTx(conn, orderId, tenantId);
    const [reasons] = await conn.execute(Q.REJECTION_REASON_BY_ID, [reasonId, tenantId]);
    if (reasons.length === 0) throw new HttpError(MESSAGES.ERROR.QR_REJECTION_REASON_UNKNOWN, 400);

    const [result] = await conn.execute(Q.REJECT, [
      reasonId, note || null, userPhone, orderId, tenantId,
    ]);
    if (result.affectedRows !== 1) throw new HttpError(MESSAGES.ERROR.QR_ORDER_NOT_PENDING, 409);

    // Give today's portions back. The count was taken when the guest ordered,
    // so a round staff refuse has to return it or the kitchen's figure drifts
    // down all service. Never throws — see releaseForOrder: a release that
    // fails must not leave staff unable to reject an order.
    await dailyStock.releaseForOrder(
      conn, parseItems(order.Items), tenantId, userPhone,
      { date: order.CreatedOn },
    );

    await refreshTable(conn, order.TableId, tenantId, userPhone);
    logger.info('QR order rejected', { tenantId, orderId, reasonId, by: userPhone });
    return { orderId, status: 'cancelled' };
  });

module.exports = { listPending, listRejectionReasons, accept, reject, toPending };
