// src/utils/orderLine.js
//
// How many of a dish one order line is for.
//
// WHY THIS IS A FILE AND NOT AN EXPRESSION. A line arrives with its quantity
// under `qty` from the till and under `quantity` from the diner app and the
// portal adapters, and nothing normalises it: priceItems spreads the original
// line, so whichever key the caller used is the one that survives all the way
// into pos_order.Items.
//
// That was fine while every reader happened to write the same `?? ` chain. The
// first reader that did not — the daily portion counts — read only `quantity`,
// fell through to a default on every till order, and recorded one portion sold
// however many were actually ordered. A per-order cap of two also passed a
// four-tea order, because the number it compared was 1.
//
// So the chain lives here, once, and every reader asks this.

/**
 * The quantity on an order line, whichever shape the caller used.
 *
 * Zero for anything unparseable rather than one: a line nobody can read the
 * quantity of should move no stock and cost nothing, not quietly become a sale.
 *
 * @param {Object} line - A raw or priced order line.
 * @returns {number}
 */
const quantityOf = (line) => Number(line?.qty ?? line?.quantity ?? 1) || 0;

/** The menu id on an order line, under either casing. */
const itemMetaIdOf = (line) => line?.id || line?.Id || null;

/**
 * Lines folded to one total per dish.
 *
 * Two lines of the same biryani are two lines on a ticket but ONE draw on the
 * day's count, and a cap of two is not a licence to send four by splitting them.
 *
 * @param {Array<Object>} lines
 * @returns {Map<string, number>} itemMetaId → total quantity
 */
const quantityByItem = (lines) => {
  const out = new Map();
  (Array.isArray(lines) ? lines : []).forEach((line) => {
    const id = itemMetaIdOf(line);
    if (!id) return;
    out.set(id, (out.get(id) || 0) + quantityOf(line));
  });
  return out;
};

module.exports = { quantityOf, itemMetaIdOf, quantityByItem };
