// src/utils/taxCalculator.js
// Pure tax & money arithmetic. NO database, NO imports — every rule here is
// unit-testable without a single mock, which is the whole point of keeping it
// separate from pricing.service.
//
// ── Why integer minor units ──────────────────────────────────────────────────
// Money must never be added or multiplied as a float: 0.1 + 0.2 === 0.30000000000000004.
// Everything below converts to paise (integer) at the boundary, computes, and
// converts back exactly once.
//
// ── Settled policy this file implements (see TAX_ENGINE_DESIGN.md §6) ────────
//   * Rounding    — per line, then sum. Each line's tax rounds to 2dp.
//   * Discount    — applied BEFORE tax, on the line amount.
//   * Components  — allocated by largest remainder so they sum EXACTLY to the
//                   line's tax. Without this, CGST+SGST can miss the total by a
//                   paisa and the invoice will not foot.

/** Percent values carry at most 2 decimals (Joi enforces it), so 1% = 100 "bp". */
const BP_PER_PERCENT = 100;
const BP_100_PERCENT = 100 * BP_PER_PERCENT; // 10000

/**
 * Parses a money/percent value that may arrive as a number or a VARCHAR string.
 * Master data stores costinfo.Amount and TaxTypes.Value as VARCHAR(50), so this
 * has to tolerate '120', '120.00', ' 120 ', '1,200.50' and junk.
 * @param {*} value
 * @returns {number} Finite number; 0 when unparseable.
 */
const parseMoney = (value) => {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const cleaned = String(value).trim().replace(/,/g, '');
  if (cleaned === '') return 0;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
};

/**
 * Converts a value to integer hundredths, rounding half away from zero.
 *
 * Deliberately goes via the decimal STRING rather than `Math.round(v * 100)`:
 * 1.005 is held as 1.00499999999999989 in binary floating point, so the naive
 * form silently rounds it down to 1.00. Reading the digits avoids that.
 *
 * Doubles as the percent→basis-point converter (9.25% → 925).
 * @param {*} value
 * @returns {number} Integer hundredths.
 */
const toMinor = (value) => {
  const num = parseMoney(value);
  if (num === 0) return 0;

  const text = String(num);
  const match = /^(-)?(\d*)(?:\.(\d*))?$/.exec(text);
  // Exponential notation ('1e-7') and anything unexpected: fall back to float
  // rounding, which is accurate enough for magnitudes that small.
  if (!match) return Math.round(num * 100);

  const sign = match[1] ? -1 : 1;
  const whole = match[2] || '0';
  const frac = match[3] || '';

  const hundredths = Number(`${whole}${frac.slice(0, 2).padEnd(2, '0')}`);
  const nextDigit = frac.charAt(2);
  const roundUp = nextDigit !== '' && Number(nextDigit) >= 5;

  return sign * (hundredths + (roundUp ? 1 : 0));
};

/**
 * Converts integer hundredths back to a 2dp number.
 * @param {number} minor
 * @returns {number}
 */
const fromMinor = (minor) => Number((minor / 100).toFixed(2));

/**
 * Splits `total` across `weights` so the parts sum EXACTLY to `total`.
 *
 * Largest-remainder method: floor every share, then hand the leftover units one
 * at a time to whichever entries were cut by the most. This is what stops
 * CGST 7.63 + SGST 7.63 = 15.26 from being reported against a 15.25 total.
 *
 * @param {number} total - Integer units to distribute.
 * @param {number[]} weights - Relative weights (any scale).
 * @returns {number[]} Integer parts, same length as weights, summing to total.
 */
const allocate = (total, weights) => {
  const count = weights.length;
  if (count === 0) return [];

  const weightSum = weights.reduce((sum, w) => sum + w, 0);
  // No weights to divide by — nothing can be attributed to any component.
  if (weightSum <= 0) return new Array(count).fill(0);

  const sign = total < 0 ? -1 : 1;
  const magnitude = Math.abs(total);

  const exact = weights.map((w) => (magnitude * w) / weightSum);
  const parts = exact.map((v) => Math.floor(v));
  let remaining = magnitude - parts.reduce((sum, v) => sum + v, 0);

  // Largest fractional remainder wins; ties break on the earlier index so the
  // result is deterministic for identical rates (the CGST/SGST case).
  const order = exact
    .map((v, index) => ({ index, remainder: v - Math.floor(v) }))
    .sort((a, b) => (b.remainder - a.remainder) || (a.index - b.index));

  for (let i = 0; i < order.length && remaining > 0; i += 1) {
    parts[order[i].index] += 1;
    remaining -= 1;
  }

  return parts.map((v) => v * sign);
};

/**
 * Reduces an amount by a discount, before any tax is applied.
 * @param {number} amountMinor - Line amount in minor units.
 * @param {Object|null} discount - { type: 'percent'|'amount', value }
 * @returns {number} Discount in minor units, never more than the amount.
 */
const discountMinorFor = (amountMinor, discount) => {
  if (!discount || !discount.value) return 0;
  const raw =
    discount.type === 'percent'
      ? Math.round((amountMinor * toMinor(discount.value)) / (100 * 100))
      : toMinor(discount.value);
  // A discount can zero a line but never make it negative.
  return Math.max(0, Math.min(raw, amountMinor));
};

/**
 * Computes the tax breakdown for a single amount.
 *
 * @param {Object} input
 * @param {number|string} input.amount - Unit amount (net if exclusive, gross if inclusive).
 * @param {boolean} input.isTaxIncluded - Whether `amount` already contains tax.
 * @param {Array<{id?:string,name?:string,rate:number|string}>} input.components - Resolved tax types.
 * @param {number} [input.quantity=1] - Line quantity; may be fractional.
 * @param {number|string} [input.addOn=0] - Flat per-unit surcharge (e.g. selected
 *        variants) added to `amount` BEFORE tax. It is not taxed separately: it
 *        simply raises the unit price, so it inherits the item's tax group and
 *        its inclusive/exclusive convention.
 * @param {Object|null} [input.discount=null] - { type:'percent'|'amount', value } applied BEFORE tax.
 * @returns {Object} Breakdown; `components` always sums exactly to `taxAmount`.
 */
const computeTax = ({
  amount,
  isTaxIncluded = false,
  components = [],
  quantity = 1,
  addOn = 0,
  discount = null,
}) => {
  const baseMinor = toMinor(amount);
  const addOnMinor = toMinor(addOn);
  // The surcharge is folded into the unit price, so everything downstream —
  // rounding, inclusive back-derivation, component allocation — treats the
  // combined figure as one price. That is what "add on, don't calculate
  // separately" means in practice.
  const unitMinor = baseMinor + addOnMinor;
  const qty = Number.isFinite(Number(quantity)) ? Number(quantity) : 1;

  // Whole-line amount first: policy is to round once per line, not per unit.
  const lineMinor = Math.round(unitMinor * qty);
  const discountMinor = discountMinorFor(lineMinor, discount);
  const taxableMinor = lineMinor - discountMinor;

  const safeComponents = (components || []).filter((c) => c && c.rate !== undefined);
  const rateBps = safeComponents.map((c) => toMinor(c.rate));
  const totalBp = rateBps.reduce((sum, bp) => sum + bp, 0);

  let netMinor;
  let taxMinor;
  let grossMinor;

  if (totalBp <= 0) {
    // A group with no active tax types is a valid "Exempt" group, not an error.
    netMinor = taxableMinor;
    taxMinor = 0;
    grossMinor = taxableMinor;
  } else if (isTaxIncluded) {
    // `amount` already contains the tax: peel it back out.
    grossMinor = taxableMinor;
    netMinor = Math.round((grossMinor * BP_100_PERCENT) / (BP_100_PERCENT + totalBp));
    // Derived, never rounded independently — guarantees net + tax === gross.
    taxMinor = grossMinor - netMinor;
  } else {
    netMinor = taxableMinor;
    taxMinor = Math.round((netMinor * totalBp) / BP_100_PERCENT);
    grossMinor = netMinor + taxMinor;
  }

  const componentMinors = allocate(taxMinor, rateBps);

  return {
    quantity: qty,
    // unitAmount is the EFFECTIVE unit price (base + add-on) — the figure the
    // line is actually taxed on. baseAmount/addOnAmount are kept alongside so a
    // bill can show "Dosa 120 + Cheese 30" rather than an unexplained 150.
    unitAmount: fromMinor(unitMinor),
    baseAmount: fromMinor(baseMinor),
    addOnAmount: fromMinor(addOnMinor),
    lineAmount: fromMinor(lineMinor),
    discountAmount: fromMinor(discountMinor),
    netAmount: fromMinor(netMinor),
    taxAmount: fromMinor(taxMinor),
    grossAmount: fromMinor(grossMinor),
    effectiveRate: totalBp / BP_PER_PERCENT,
    isTaxIncluded: !!isTaxIncluded,
    components: safeComponents.map((c, i) => ({
      id: c.id ?? null,
      name: c.name ?? null,
      rate: rateBps[i] / BP_PER_PERCENT,
      amount: fromMinor(componentMinors[i]),
    })),
  };
};

/**
 * Aggregates line breakdowns into document totals, including the per-component
 * footer an invoice needs (CGST ₹x / SGST ₹y).
 * @param {Array<Object>} lines - Results of computeTax.
 * @returns {Object} { netAmount, taxAmount, grossAmount, discountAmount, taxByComponent }
 */
const sumLines = (lines) => {
  const totals = lines.reduce(
    (acc, line) => {
      acc.net += toMinor(line.netAmount);
      acc.tax += toMinor(line.taxAmount);
      acc.gross += toMinor(line.grossAmount);
      acc.discount += toMinor(line.discountAmount);
      return acc;
    },
    { net: 0, tax: 0, gross: 0, discount: 0 },
  );

  // Group components by name so the footer shows one CGST row, not one per line.
  const byName = new Map();
  lines.forEach((line) => {
    (line.components || []).forEach((c) => {
      const key = c.name ?? c.id ?? 'TAX';
      const entry = byName.get(key) || { id: c.id ?? null, name: c.name ?? null, rate: c.rate, amount: 0 };
      entry.amount += toMinor(c.amount);
      byName.set(key, entry);
    });
  });

  return {
    netAmount: fromMinor(totals.net),
    taxAmount: fromMinor(totals.tax),
    grossAmount: fromMinor(totals.gross),
    discountAmount: fromMinor(totals.discount),
    taxByComponent: [...byName.values()].map((c) => ({ ...c, amount: fromMinor(c.amount) })),
  };
};

module.exports = {
  parseMoney,
  toMinor,
  fromMinor,
  allocate,
  discountMinorFor,
  computeTax,
  sumLines,
};
