// src/modules/posdailystock/posdailystock.service.js
//
// How many of each dish the kitchen made today, and what that does to an order.
//
// WHAT THIS OWNS
// The day's counts and the act of taking from them. It does NOT own whether a
// dish is on the menu at all — that is pos_item_meta.Active and the category
// schedule, enforced in posorder.assertLinesAreOnMenu, and it is checked first:
// a dish switched off is off whatever its count says.
//
// WHERE THE DEDUCTION HAPPENS, AND WHY IT MATTERS
// `consumeForOrder` takes a connection and must be called INSIDE the order's
// transaction. The availability checks beside it deliberately run outside one
// (see assertLinesAreOnMenu's comment: refusing a portal order the aggregator
// already charged for would strand a paid order). A stock check placed there
// would inherit that check-then-act gap and could still oversell. The guard
// lives in the UPDATE's WHERE clause instead, so the deduction and the check
// are one statement and a lost race is simply a row that did not match.

const { withConnection, withTransaction } = require('../../utils/dbHelper');
const { HttpError } = require('../../middleware/errorHandler');
const MESSAGES = require('../../config/messages');
const { businessDate } = require('../../utils/dateRange');
const { quantityByItem, itemMetaIdOf } = require('../../utils/orderLine');
const { logger } = require('../../utils/logger');
const repository = require('./posdailystock.repository');
const { resolve, refusalFor, isTracked, STOCK_STATE } = require('./posdailystock.resolver');

/** The day a count belongs to. One helper so every caller agrees. */
const dayOf = (date) => (date ? businessDate(date) : businessDate());

/**
 * Every tracked dish on a branch for one day, resolved for the counts screen.
 *
 * Returns the dishes with no row too — "tracked but not set today" is the state
 * the operator most needs to see, and it is invisible if the query skips it.
 */
const listForDay = async (branchId, tenantId, date) => withConnection(async (conn) => {
  const day = dayOf(date);
  const rows = await repository.listForDay(conn, { branchId, businessDate: day }, tenantId);
  return {
    branchId,
    businessDate: day,
    items: rows.map((r) => ({
      itemMetaId: r.ItemMetaId,
      name: r.ItemName,
      ...resolve(r),
    })),
  };
});

/** Set how many were made. Does not disturb what has already been sold. */
const setPrepared = async ({ branchId, itemMetaId, date, preparedQty }, tenantId, userPhone) =>
  withTransaction(async (conn) => {
    const day = dayOf(date);
    await repository.setPrepared(
      conn, { branchId, itemMetaId, businessDate: day, preparedQty }, tenantId, userPhone,
    );
    logger.info('Daily stock set', { tenantId, branchId, itemMetaId, day, preparedQty });
    const found = await repository.findForItems(
      conn, { itemMetaIds: [itemMetaId], businessDate: day }, tenantId,
    );
    const row = found.get(itemMetaId);
    if (!row) {
      throw new HttpError(MESSAGES.ERROR.NOT_FOUND || 'That dish is not on this menu.', 404);
    }
    return { itemMetaId, businessDate: day, name: row.ItemName, ...resolve(row) };
  });

/** Remove the day's count — the dish goes back to "not available today". */
const clearDay = async ({ itemMetaId, date }, tenantId, userPhone) =>
  withTransaction(async (conn) => {
    const day = dayOf(date);
    await repository.clear(conn, { itemMetaId, businessDate: day }, tenantId);
    logger.info('Daily stock cleared', { tenantId, itemMetaId, day, by: userPhone });
    return { itemMetaId, businessDate: day, stockState: STOCK_STATE.UNAVAILABLE, remaining: 0 };
  });

/**
 * The friendly pre-check, run with the other availability asserts.
 *
 * ADVISORY ONLY. It gives "only 2 left" instead of a bare 409, but it cannot be
 * the authority: it runs outside the order's transaction, so between it and the
 * insert another till can take the last portion. `consumeForOrder` is the
 * authority. This exists because the alternative is a worse error message, not
 * because it makes anything safe.
 *
 * @param {Array} items - Raw Items[] from the request.
 * @param {string} tenantId
 * @param {Object} [opts] - { date }
 */
const assertStockAvailable = async (items, tenantId, opts = {}) => {
  const lines = Array.isArray(items) ? items : [];
  if (lines.length === 0) return;
  const day = dayOf(opts.date);

  const byId = await withConnection((conn) => repository.findForItems(
    conn, { itemMetaIds: lines.map(itemMetaIdOf), businessDate: day }, tenantId,
  ));

  const problems = [];
  const wanted = quantityByItem(lines);

  wanted.forEach((qty, id) => {
    const row = byId.get(id);
    if (!row) return; // not on this menu — assertLinesAreOnMenu owns that answer
    const refusal = refusalFor(row, qty, row.ItemName);
    if (refusal) problems.push(refusal);
  });

  if (problems.length > 0) throw new HttpError(problems.join(' '), 400);
};

/**
 * Take the portions an order needs. THE AUTHORITY.
 *
 * @param {Object} conn - The order transaction's connection. Required.
 * @param {Array} items - The order's lines.
 * @param {string} tenantId
 * @param {string} userPhone
 * @param {Object} [opts] - { date, guard } — guard:false for an order already
 *   paid for elsewhere (a portal), which decrements without refusing.
 * @throws {HttpError} 409 when a dish ran out between the pre-check and here.
 */
const consumeForOrder = async (conn, items, tenantId, userPhone, opts = {}) => {
  const lines = Array.isArray(items) ? items : [];
  if (lines.length === 0) return;
  const day = dayOf(opts.date);
  const guard = opts.guard !== false;

  const byId = await repository.findForItems(
    conn, { itemMetaIds: lines.map(itemMetaIdOf), businessDate: day }, tenantId,
  );

  const wanted = quantityByItem(lines);

  for (const [itemMetaId, qty] of wanted) {
    const row = byId.get(itemMetaId);
    if (!row || !isTracked(row)) continue;

    if (!guard) {
      await repository.consumeUnchecked(
        conn, { itemMetaId, businessDate: day, qty }, tenantId, userPhone,
      );
      continue;
    }

    const took = await repository.consume(
      conn, { itemMetaId, businessDate: day, qty }, tenantId, userPhone,
    );
    if (!took) {
      // Either it was never set today, or somebody took the last one while this
      // order was being priced. Both are a 409: the request was legal when it
      // was made and is not any more.
      throw new HttpError(
        `${row.ItemName || 'An item'} is no longer available in that quantity.`,
        MESSAGES.HTTP_STATUS.CONFLICT,
      );
    }
  }
};

/**
 * Give an order's portions back, for a round that was rejected or cancelled.
 *
 * Never throws: a release that fails must not stop staff rejecting an order. A
 * count that is too low is visible on the counts screen and fixable there; a
 * round that cannot be rejected is a table nobody can clear.
 */
const releaseForOrder = async (conn, items, tenantId, userPhone, opts = {}) => {
  try {
    const lines = Array.isArray(items) ? items : [];
    if (lines.length === 0) return;
    const day = dayOf(opts.date);

    const byId = await repository.findForItems(
      conn, { itemMetaIds: lines.map(itemMetaIdOf), businessDate: day }, tenantId,
    );

    const wanted = quantityByItem(lines);

    for (const [itemMetaId, qty] of wanted) {
      const row = byId.get(itemMetaId);
      if (!row || !isTracked(row)) continue;
      await repository.release(
        conn, { itemMetaId, businessDate: day, qty }, tenantId, userPhone,
      );
    }
  } catch (err) {
    logger.error('Could not release daily stock', { tenantId, err: err.message });
  }
};

module.exports = {
  listForDay, setPrepared, clearDay,
  assertStockAvailable, consumeForOrder, releaseForOrder,
  dayOf,
};
