// src/modules/posdine/dine.order.service.js
// A guest placing a round from their phone, and following it.
//
// The round goes through posorder.service — the same menu, add-on, trading-hour
// and pricing checks as the till, unchanged — with every id that matters taken
// from the SESSION: table, customer, branch. From the request only the dish ids,
// quantities, option ids and notes are read; names come from the catalogue and
// prices from the pricing engine.
//
// It is created OPEN with NO kitchen ticket. Staff accept it from the review
// queue (posqr.orders.service), which fires the KOT. QR_TABLE_ORDERING_DESIGN.md §4.5.

const { withConnection, withTransaction } = require('../../utils/dbHelper');
const { QUERIES, QR_ORDERING } = require('../../config/constants');
const MESSAGES = require('../../config/messages');
const { HttpError } = require('../../middleware/errorHandler');
const { logger } = require('../../utils/logger');
const posOrderService = require('../posorder/posorder.service');
const { refreshTable } = require('../posorder/posorder.transfer');
const qrChannel = require('../posqr/posqr.channel');

const Q = QUERIES.POS_DINE;

// A round that has been billed. Mirrors posorder.service's CLOSED_STATUSES
// minus 'cancelled', which statusOf answers before this is consulted because a
// rejected round reads differently to a guest than a finished one.
const SETTLED_STATUSES = new Set(['closed', 'settled']);

const createdByOf = (diner) => `${QR_ORDERING.CREATED_BY_PREFIX}${diner.phone}`;

/**
 * Names of the requested dishes that are on sale at THIS branch.
 * @returns {Promise<Map<string, string>>} itemMetaId → catalogue name
 */
const namesOnBranch = async (ids, { tenantId, branchId }) => {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  return withConnection(async (conn) => {
    const [rows] = await conn.execute(
      Q.ITEMS_ON_BRANCH.replace(':ids', new Array(unique.length).fill('?').join(', ')),
      [tenantId, branchId, ...unique],
    );
    return new Map(rows.map((r) => [r.Id, r.Name]));
  });
};

/**
 * The request's lines, rebuilt from whitelisted fields only. A client-sent
 * price, discount, name or costInfoId never reaches the order.
 * @param {Array<Object>} items - Validated by dine.schemas.
 * @param {Object} diner - Session context.
 * @returns {Promise<Array<Object>>}
 */
const buildLines = async (items, diner) => {
  if (!Array.isArray(items) || items.length === 0) {
    throw new HttpError(MESSAGES.ERROR.QR_EMPTY_ORDER, 400);
  }
  const names = await namesOnBranch(items.map((l) => l.id), diner);
  if (items.some((l) => !names.has(l.id))) {
    throw new HttpError(MESSAGES.ERROR.QR_ITEM_NOT_AT_BRANCH, 400);
  }
  return items.map((l) => ({
    id: l.id,
    name: names.get(l.id),
    quantity: l.quantity,
    variantIds: l.variantIds || [],
    addonIds: l.addonIds || [],
    ...(l.note ? { note: l.note } : {}),
  }));
};

/**
 * What the cart would cost, priced by the server. Checks nothing about the
 * branch's mode, so a menu-only branch can still show a guest a total.
 */
const quote = async (items, diner) => {
  const lines = await buildLines(items, diner);
  const priced = await posOrderService.priceItems(lines, diner.tenantId);
  if (!priced) return { lines: [], subTotal: 0, taxAmount: 0, total: 0 };
  return {
    lines: priced.items.map((l) => ({
      id: l.id, name: l.name, quantity: l.quantity,
      amount: Number(l.grossAmount ?? l.lineTotal ?? 0) || 0,
    })),
    subTotal: priced.totals.netAmount,
    taxAmount: priced.totals.taxAmount,
    total: priced.totals.grossAmount,
  };
};

/**
 * Places a round at the diner's table.
 * @param {{items: Array, cookingInstructions?: string}} body - Validated.
 * @param {Object} diner - Session context, incl. settings.
 * @returns {Promise<Object>} The round as the guest sees it.
 */
const place = async ({ items, cookingInstructions }, diner) => {
  if (!diner.settings.canOrder) throw new HttpError(MESSAGES.ERROR.QR_MENU_ONLY, 409);

  const lines = await buildLines(items, diner);
  const channelId = await qrChannel.ensureQrChannel(diner.tenantId);
  const createdBy = createdByOf(diner);

  // create() runs the till's full validation and pricing, then inserts in its
  // own transaction. The table is marked occupied afterwards — on the till the
  // screen does that; here nobody else will.
  const round = await posOrderService.create({
    Items: lines,
    CookingInstructions: cookingInstructions || null,
    TableId: diner.tableId,
    CustomerId: diner.customerId,
    BranchDetailId: diner.branchId,
    OrderType: 'dinein',
    ChannelId: channelId,
    Status: 'open',
  }, diner.tenantId, createdBy);

  await withTransaction((conn) => refreshTable(conn, diner.tableId, diner.tenantId, createdBy));

  logger.info('QR order placed', {
    tenantId: diner.tenantId, branchId: diner.branchId, tableId: diner.tableId,
    orderId: round.id || round.Id,
  });
  return {
    id: round.id || round.Id,
    orderNo: round.OrderNo,
    status: 'waiting',
    total: Number(round.Total) || 0,
  };
};

/**
 * Where a round stands, in the words a guest understands.
 * open + no ticket → waiting for staff · ticket → kitchen · ticket ready/served
 * → ready · closed → served (terminal) · cancelled → rejected (with the reason
 * staff gave).
 *
 * THE CLOSED CHECK COMES FIRST, and it is the whole reason this has five states
 * rather than four. A settled round keeps its KOT status — 'ready' or 'served' —
 * so without this it fell through to 'ready' and the guest's phone went on
 * saying "Ready, on its way" after they had paid and left, for as long as the
 * session lasted. A round that has been billed is finished, whatever its ticket
 * still says.
 */
const statusOf = (row) => {
  const status = String(row.Status || '').toLowerCase();
  const kot = String(row.KotStatus || '').toLowerCase();
  if (status === 'cancelled') return 'rejected';
  if (SETTLED_STATUSES.has(status)) return 'served';
  if (!kot) return status === 'open' ? 'waiting' : 'kitchen';
  if (kot === 'ready' || kot === 'served' || kot === 'completed') return 'ready';
  return 'kitchen';
};

const parseItems = (v) => {
  if (Array.isArray(v)) return v;
  try { return JSON.parse(v || '[]'); } catch { return []; }
};

/**
 * This diner's rounds at this table since their session began.
 * @param {Object} diner - Session context (incl. sessionStartedAt).
 */
const listMine = (diner) =>
  withConnection(async (conn) => {
    const [rows] = await conn.execute(Q.ORDERS_FOR_DINER, [
      diner.tenantId, diner.tableId, diner.customerId, diner.sessionStartedAt,
    ]);
    return rows.map((r) => ({
      id: r.Id,
      orderNo: r.OrderNo,
      status: statusOf(r),
      placedAt: r.CreatedOn,
      items: parseItems(r.Items).map((l) => ({
        name: l.name,
        quantity: Number(l.quantity) || 1,
        variants: (l.variants || []).map((v) => v.name).filter(Boolean),
        addons: (l.addons || []).map((a) => a.name).filter(Boolean),
        note: l.note || null,
      })),
      subTotal: Number(r.SubTotal) || 0,
      taxAmount: Number(r.TaxAmount) || 0,
      total: Number(r.Total) || 0,
      rejection: statusOf(r) === 'rejected'
        ? { reason: r.RejectionReason || null, note: r.RejectionNote || null }
        : null,
    }));
  });

module.exports = { quote, place, listMine, statusOf, buildLines };
