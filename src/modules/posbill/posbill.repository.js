// src/modules/posbill/posbill.repository.js
// Bill ↔ orders link, and the priced line snapshots a bill is recomputed from.

const { QUERIES } = require('../../config/constants');

const expandIds = (sql, count) =>
  sql.replace(':ids', new Array(count).fill('?').join(', '));

const asArray = (v) => {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') {
    try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch { return []; }
  }
  return [];
};

/**
 * Replaces the set of orders a bill covers. Takes an open connection so the
 * links commit with the bill itself.
 * @param {Object} conn - Open transaction connection.
 * @param {string} billId
 * @param {string[]} orderIds
 * @param {string} tenantId
 * @param {string} userEmail
 */
const setBillOrdersTx = async (conn, billId, orderIds, tenantId, userEmail) => {
  const { v4: uuidv4 } = require('uuid');
  await conn.execute(QUERIES.POS_BILL_ORDER.DELETE_BY_BILL, [billId, tenantId]);
  for (const orderId of [...new Set((orderIds || []).filter(Boolean))]) {
    await conn.execute(QUERIES.POS_BILL_ORDER.INSERT, [
      uuidv4(), billId, orderId, tenantId, userEmail,
    ]);
  }
};

/**
 * Order ids a bill covers.
 * @param {Object} conn
 * @param {string} billId
 * @param {string} tenantId
 * @returns {Promise<string[]>}
 */
const getBillOrderIdsTx = async (conn, billId, tenantId) => {
  const [rows] = await conn.execute(QUERIES.POS_BILL_ORDER.SELECT_ORDER_IDS, [
    billId, tenantId,
  ]);
  return rows.map((r) => r.OrderId);
};

/**
 * Flattens the priced line snapshots of several orders into one list.
 *
 * Uses what the orders STORED, not the live tax chain — a bill must reflect the
 * rates in force when each round was ordered, even if a tax group changed since.
 *
 * @param {Object} conn
 * @param {string[]} orderIds
 * @param {string} tenantId
 * @returns {Promise<Array<Object>>} Lines shaped for pricing.priceSnapshotLines.
 */
const getOrderLinesTx = async (conn, orderIds, tenantId) => {
  const ids = [...new Set((orderIds || []).filter(Boolean))];
  if (ids.length === 0) return [];

  const sql = expandIds(QUERIES.POS_BILL_ORDER.SELECT_ORDER_ITEMS, ids.length);
  const [rows] = await conn.execute(sql, [tenantId, ...ids]);

  const lines = [];
  rows.forEach((row) => {
    asArray(row.Items).forEach((item) => {
      lines.push({
        orderId: row.Id,
        id: item.id ?? item.Id ?? null,
        name: item.name ?? null,
        costInfoId: item.costInfoId ?? null,
        // Options as charged, carried through so a printed bill can itemise
        // "Dosa (Large, Extra cheese)".
        variants: Array.isArray(item.variants) ? item.variants : [],
        basePrice: item.basePrice ?? null,
        variantAmount: item.variantAmount ?? 0,
        // Already includes the variant surcharge — see posorder.priceItems.
        unitAmount: item.price ?? item.unitAmount ?? 0,
        quantity: Number(item.qty ?? item.quantity ?? 1) || 0,
        isTaxIncluded: !!item.isTaxIncluded,
        // Rates as captured at order time. An order placed before pricing
        // shipped has none, so it prices as 0% rather than picking up today's.
        components: Array.isArray(item.taxComponents) ? item.taxComponents : [],
      });
    });
  });
  return lines;
};

/**
 * The bill's lines shaped for the ledger.
 *
 * Ledger lines reference the MASTER item (`itemdetail`), not the POS menu row,
 * so each line's `pos_item_meta.Id` is resolved to its `ItemDetailId`. Everything
 * else is the snapshot the order already stored — this never re-prices.
 *
 * @param {Object} conn
 * @param {string[]} orderIds
 * @param {string} tenantId
 * @returns {Promise<Array<Object>>}
 */
const getLedgerLinesTx = async (conn, orderIds, tenantId) => {
  const lines = await getOrderLinesTx(conn, orderIds, tenantId);
  if (lines.length === 0) return [];

  const metaIds = [...new Set(lines.map((l) => l.id).filter(Boolean))];
  let itemByMeta = new Map();
  if (metaIds.length > 0) {
    const placeholders = new Array(metaIds.length).fill('?').join(', ');
    const [rows] = await conn.execute(
      `SELECT Id, ItemDetailId FROM pos_item_meta WHERE TenantId = ? AND Id IN (${placeholders})`,
      [tenantId, ...metaIds],
    );
    itemByMeta = new Map(rows.map((r) => [r.Id, r.ItemDetailId]));
  }

  return lines.map((l) => ({
    itemDetailId: itemByMeta.get(l.id) || null,
    costInfoId: l.costInfoId,
    name: l.name,
    quantity: l.quantity,
    unitAmount: l.unitAmount,
    basePrice: l.basePrice,
    variantAmount: l.variantAmount,
    variants: l.variants,
    netAmount: l.netAmount,
    taxAmount: l.taxAmount,
    grossAmount: l.grossAmount,
    taxComponents: l.components,
  }));
};

/**
 * The customer attached to a table session, if any.
 * Rounds belong to one session, so the first order carrying a customer wins.
 * @param {Object} conn
 * @param {string[]} orderIds
 * @param {string} tenantId
 * @returns {Promise<string|null>}
 */
const getSessionCustomerIdTx = async (conn, orderIds, tenantId) => {
  const ids = [...new Set((orderIds || []).filter(Boolean))];
  if (ids.length === 0) return null;
  const placeholders = new Array(ids.length).fill('?').join(', ');
  const [rows] = await conn.execute(
    `SELECT CustomerId FROM pos_order
      WHERE TenantId = ? AND Id IN (${placeholders}) AND CustomerId IS NOT NULL
      ORDER BY CreatedOn ASC LIMIT 1`,
    [tenantId, ...ids],
  );
  return rows && rows.length > 0 ? rows[0].CustomerId : null;
};

module.exports = {
  setBillOrdersTx,
  getBillOrderIdsTx,
  getOrderLinesTx,
  getLedgerLinesTx,
  getSessionCustomerIdTx,
  asArray,
};
