// src/modules/posdailystock/posdailystock.repository.js
//
// SQL only. The rules about what a row MEANS live in the resolver; what a count
// does to an order lives in the service. Every function takes a connection
// rather than opening one, because the consume and release below belong inside
// the order's own transaction — a repository that opened its own could not join
// it, and a count that moved outside the order's transaction would survive a
// rolled-back sale.

const { v4: uuidv4 } = require('uuid');
const { QUERIES } = require('../../config/constants');

const Q = QUERIES.POS_DAILY_STOCK;

const bind = (sql, n) => sql.replace(':ids', new Array(n).fill('?').join(', '));

/** Every tracked dish on a branch, with this day's count where one was set. */
const listForDay = async (conn, { branchId, businessDate }, tenantId) => {
  const [rows] = await conn.execute(Q.SELECT_FOR_DAY, [businessDate, tenantId, branchId]);
  return rows || [];
};

/**
 * The menu + count rows for specific dishes, keyed by item-meta id.
 *
 * Ids are bound one placeholder each, never interpolated. An empty list
 * short-circuits rather than emitting `IN ()`, which MySQL rejects.
 */
const findForItems = async (conn, { itemMetaIds, businessDate }, tenantId) => {
  const ids = [...new Set((itemMetaIds || []).filter(Boolean))];
  if (ids.length === 0) return new Map();
  const [rows] = await conn.execute(
    bind(Q.SELECT_FOR_ITEMS, ids.length), [businessDate, tenantId, ...ids],
  );
  return new Map((rows || []).map((r) => [r.ItemMetaId, r]));
};

/** Set (or change) how many were made. Never touches SoldQty — see the query. */
const setPrepared = async (conn, { branchId, itemMetaId, businessDate, preparedQty }, tenantId, userPhone) => {
  await conn.execute(Q.UPSERT, [
    uuidv4(), tenantId, branchId, itemMetaId, businessDate, preparedQty, userPhone, userPhone,
  ]);
};

/** Remove the day's count, returning the dish to "not available today". */
const clear = async (conn, { itemMetaId, businessDate }, tenantId) => {
  await conn.execute(Q.CLEAR, [tenantId, itemMetaId, businessDate]);
};

/**
 * Take `qty` portions, refusing if they are not there.
 *
 * @returns {Promise<boolean>} false when another order got there first — the
 *   guard is in the UPDATE's WHERE, so this is the only report of a lost race.
 */
const consume = async (conn, { itemMetaId, businessDate, qty }, tenantId, userPhone) => {
  const [res] = await conn.execute(Q.CONSUME, [
    qty, userPhone, tenantId, itemMetaId, businessDate, qty,
  ]);
  return (res?.affectedRows ?? 0) > 0;
};

/**
 * Take `qty` without the guard, for an order already paid for elsewhere.
 *
 * Allowed to drive the count negative. A portal has taken the guest's money
 * before the order reaches us; refusing it strands a paid order instead of
 * preventing one, and an honest negative tells staff exactly what happened.
 */
const consumeUnchecked = async (conn, { itemMetaId, businessDate, qty }, tenantId, userPhone) => {
  await conn.execute(Q.CONSUME_UNCHECKED, [
    qty, userPhone, tenantId, itemMetaId, businessDate,
  ]);
};

/** Give portions back. Floored at zero by the query. */
const release = async (conn, { itemMetaId, businessDate, qty }, tenantId, userPhone) => {
  await conn.execute(Q.RELEASE, [qty, userPhone, tenantId, itemMetaId, businessDate]);
};

module.exports = {
  listForDay, findForItems, setPrepared, clear, consume, consumeUnchecked, release,
};
