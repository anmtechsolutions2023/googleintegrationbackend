// src/modules/pricing/pricing.enrich.js
// Attaches a tax breakdown to rows that reference a costinfo record.
//
// Used by the `?expand=true` read paths (costinfo, itemdetail, pos item-meta,
// batchdetail) so any screen that shows a price can show what it is made of.
//
// ── Read paths only ─────────────────────────────────────────────────────────
// These are CURRENT master-data reads, so pricing them live is correct. Stored
// documents (orders, bills, invoices) must NOT be enriched this way — they carry
// their own snapshot taken at write time, and re-pricing them against today's
// rates would silently rewrite history. See TAX_ENGINE_PLAN.md §3.

const pricingService = require('./pricing.service');
const { computeTax } = require('../../utils/taxCalculator');

/**
 * Adds `TaxBreakdown` to each row, resolved from the row's costinfo reference.
 *
 * Batched: every row in the page is priced with ONE chain query regardless of
 * how many distinct cost records are involved.
 *
 * @param {Array<Object>} rows - Rows to enrich (mutated copies are returned).
 * @param {string} tenantId - Tenant ID.
 * @param {Object} [options]
 * @param {string} [options.idField='CostInfoId'] - Column holding the costinfo id.
 * @param {string} [options.quantityField] - Column holding a line quantity, when the
 *        row represents a quantity of something (e.g. batchdetail.Quantity) rather
 *        than a unit price.
 * @returns {Promise<Array<Object>>} Rows with `TaxBreakdown` attached.
 */
const attachBreakdown = async (rows, tenantId, options = {}) => {
  const { idField = 'CostInfoId', quantityField = null } = options;
  const list = Array.isArray(rows) ? rows : [];
  if (list.length === 0) return list;

  const ids = list.map((r) => r && r[idField]).filter(Boolean);
  if (ids.length === 0) {
    return list.map((row) => ({ ...row, TaxBreakdown: null }));
  }

  const priced = await pricingService.priceCostInfos(ids, tenantId);

  return list.map((row) => {
    const costInfoId = row ? row[idField] : null;
    const breakdown = costInfoId ? priced.get(costInfoId) : null;
    // A row with no cost link is not an error — plenty of items have no price yet.
    if (!breakdown || !breakdown.found) return { ...row, TaxBreakdown: null };

    if (!quantityField) return { ...row, TaxBreakdown: breakdown };

    // Row carries a quantity: scale the unit breakdown to the whole line so the
    // caller sees what that quantity is actually worth.
    //
    // An ABSENT quantity (null/''/undefined — batchdetail.Quantity is a nullable
    // VARCHAR) means "not recorded", so fall back to the unit price. A recorded
    // 0 is different: that line really is worth nothing, and Number(null) === 0
    // would otherwise collapse the two cases.
    const raw = row[quantityField];
    const isAbsent = raw === null || raw === undefined || String(raw).trim() === '';
    const quantity = Number(raw);
    if (isAbsent || !Number.isFinite(quantity) || quantity === 1) {
      return { ...row, TaxBreakdown: breakdown };
    }
    return {
      ...row,
      TaxBreakdown: {
        ...breakdown,
        ...scaleBreakdown(breakdown, quantity),
      },
    };
  });
};

/**
 * Re-prices a unit breakdown for a quantity, using the same calculator so the
 * per-line rounding and component allocation rules still hold.
 * @param {Object} breakdown - Unit-level breakdown.
 * @param {number} quantity
 * @returns {Object} Line-level fields.
 */
const scaleBreakdown = (breakdown, quantity) =>
  computeTax({
    amount: breakdown.unitAmount,
    isTaxIncluded: breakdown.isTaxIncluded,
    components: breakdown.components,
    quantity,
  });

/**
 * Single-row convenience wrapper.
 * @param {Object} row
 * @param {string} tenantId
 * @param {Object} [options]
 * @returns {Promise<Object>}
 */
const attachBreakdownToOne = async (row, tenantId, options = {}) => {
  if (!row) return row;
  const [enriched] = await attachBreakdown([row], tenantId, options);
  return enriched;
};

module.exports = { attachBreakdown, attachBreakdownToOne };
