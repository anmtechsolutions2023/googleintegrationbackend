// src/modules/posdailystock/posdailystock.resolver.js
//
// THE FOUR STATES, DECIDED ONCE.
//
// A dish is unlimited, unavailable, available with a count, or sold out. Every
// reader — the diner menu, the till, the order guard, the counts screen — asks
// this file, so a report and a counter cannot come to different answers about
// the same dish. The rule it encodes:
//
//   StockTracked = 0                    → unlimited    (the default, every dish today)
//   tracked, no row for this day        → unavailable  (nobody said how many were made)
//   tracked, row exists, remaining > 0  → available    ("only 3 left")
//   tracked, row exists, remaining <= 0 → sold out
//
// THE SECOND LINE IS THE ONE THAT SURPRISES PEOPLE, and it is deliberate: the
// operator asked for "if a count was missed, the dish is off". It is also why
// StockTracked has to exist at all — without it that rule would apply to the
// whole menu and every soft drink would go dark each morning.
//
// Pure. No database, no clock: the caller passes the rows and the day. That is
// what lets the ladder be tested exhaustively without a fixture.

/** The vocabulary. Exported so nothing matches these as loose strings. */
const STOCK_STATE = Object.freeze({
  UNLIMITED: 'unlimited',
  UNAVAILABLE: 'unavailable',
  AVAILABLE: 'available',
  SOLD_OUT: 'sold_out',
});

const int = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
};

/**
 * Resolve one dish's availability from its menu row and today's count row.
 *
 * @param {Object} row - A SELECT_FOR_ITEMS / SELECT_FOR_DAY row: StockTracked,
 *   MaxPerOrder, and PreparedQty/SoldQty which are null when no row exists.
 * @returns {{stockState: string, remaining: number|null, prepared: number|null,
 *   sold: number|null, maxPerOrder: number|null}}
 */
const resolve = (row = {}) => {
  const maxPerOrder = row.MaxPerOrder === null || row.MaxPerOrder === undefined
    ? null
    : int(row.MaxPerOrder);

  if (!row.StockTracked) {
    return {
      stockState: STOCK_STATE.UNLIMITED,
      remaining: null, prepared: null, sold: null, maxPerOrder,
    };
  }

  // No row for the day. NOT the same as a row reading zero: that one sold out,
  // this one was never set, and the operator needs to tell them apart.
  if (row.PreparedQty === null || row.PreparedQty === undefined) {
    return {
      stockState: STOCK_STATE.UNAVAILABLE,
      remaining: 0, prepared: null, sold: null, maxPerOrder,
    };
  }

  const prepared = int(row.PreparedQty);
  const sold = int(row.SoldQty);
  // Clamped at zero for display. A portal order is allowed to push SoldQty past
  // PreparedQty (it was already paid for), and "-2 left" helps nobody at a till.
  const remaining = Math.max(prepared - sold, 0);

  return {
    stockState: remaining > 0 ? STOCK_STATE.AVAILABLE : STOCK_STATE.SOLD_OUT,
    remaining, prepared, sold, maxPerOrder,
  };
};

/** Is an order for `qty` of this dish allowed to proceed? */
const refusalFor = (row, qty, itemName) => {
  const r = resolve(row);
  const name = itemName || row.ItemName || 'An item';

  if (r.maxPerOrder !== null && r.maxPerOrder > 0 && qty > r.maxPerOrder) {
    return `${name}: at most ${r.maxPerOrder} per order.`;
  }
  if (r.stockState === STOCK_STATE.UNLIMITED) return null;
  if (r.stockState === STOCK_STATE.UNAVAILABLE) {
    return `${name} is not available today.`;
  }
  if (r.stockState === STOCK_STATE.SOLD_OUT) return `${name} is sold out.`;
  if (qty > r.remaining) {
    return `${name}: only ${r.remaining} left.`;
  }
  return null;
};

/** Does this dish's count move when an order takes it? */
const isTracked = (row) => resolve(row).stockState !== STOCK_STATE.UNLIMITED;

module.exports = { STOCK_STATE, resolve, refusalFor, isTracked };
