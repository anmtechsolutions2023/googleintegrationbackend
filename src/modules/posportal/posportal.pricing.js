// src/modules/posportal/posportal.pricing.js
// Which price a portal sells an item at, and what tax that price carries.
//
// ONE function, used by ingest (pricing an inbound line), by the menu push
// (telling the portal what to list) and by the listings screen (previewing it).
// Three implementations of "what does Zomato charge for this?" would drift, and
// the first symptom would be a bill raised at a different number from the one
// the customer paid.
//
// ── Why the override is a costinfo id and not a decimal ─────────────────────
// Every price this system prices CORRECTLY arrives as a costinfo row carrying a
// tax group and an IsTaxIncluded flag; the whole chain
// costinfo → taxgroup → taxgrouptaxtypemapper → TaxTypes hangs off it.
// Aggregator prices are typically marked up AND tax-inclusive where dine-in is
// exclusive, so they genuinely need their own row. A bare decimal column would
// be a price with no tax identity — the exact shape that had POS bills raised
// at zero tax.

const pricingService = require('../pricing/pricing.service');

/**
 * The costinfo a portal sells this item under, resolved in order of precedence.
 *
 * Deliberately returns an ID rather than an amount: the caller hands it to the
 * tax engine, which is the only thing entitled to turn a cost row into money.
 *
 * @param {Object} row - A listing joined to its item meta. Accepts either the
 *   listing shape (PriceOverrideCostInfoId + BaseCostInfoId) or a plain
 *   item-meta row (CostInfoId), so an unlisted item still resolves.
 * @returns {{ costInfoId: string|null, source: 'override'|'branch'|'none' }}
 */
const resolveCostInfoId = (row) => {
  if (!row) return { costInfoId: null, source: 'none' };
  if (row.PriceOverrideCostInfoId) {
    return { costInfoId: row.PriceOverrideCostInfoId, source: 'override' };
  }
  const base = row.BaseCostInfoId ?? row.CostInfoId ?? null;
  return base
    ? { costInfoId: base, source: 'branch' }
    : { costInfoId: null, source: 'none' };
};

/**
 * Prices a set of listing rows in ONE batched query, whatever the mix of
 * overridden and inherited prices.
 *
 * Batched on purpose: a listing matrix is 200 rows and a portal menu push is
 * the whole catalogue. Pricing them one at a time would be 200 chain queries.
 *
 * @param {Array<Object>} rows - Listing rows (or item-meta rows).
 * @param {string} tenantId
 * @returns {Promise<Array<Object>>} Each row plus { EffectiveCostInfoId,
 *   PriceSource, TaxBreakdown } — TaxBreakdown is null when no price is set,
 *   which is a legitimate state, not an error.
 */
// Takes its own connection through pricing.service, as pricing.enrich does.
// Safe inside a transaction: it only READS costinfo master data, which the
// transaction never writes, so there is no read-after-write to miss.
const priceListings = async (rows, tenantId) => {
  const list = Array.isArray(rows) ? rows : [];
  if (list.length === 0) return [];

  const resolved = list.map((row) => ({ row, ...resolveCostInfoId(row) }));
  const ids = [...new Set(resolved.map((r) => r.costInfoId).filter(Boolean))];
  const priced = ids.length
    ? await pricingService.priceCostInfos(ids, tenantId)
    : new Map();

  return resolved.map(({ row, costInfoId, source }) => ({
    ...row,
    EffectiveCostInfoId: costInfoId,
    PriceSource: source,
    TaxBreakdown: costInfoId ? priced.get(costInfoId) ?? null : null,
  }));
};

/**
 * What the portal should charge for a quantity of one listing.
 *
 * The gross is what the customer pays on the portal, so it is the figure the
 * order total is built from — net and tax are carried alongside because the
 * bill has to be raised with the split the tax engine computed, not one derived
 * afterwards by arithmetic on a rounded gross.
 *
 * @param {Object} pricedRow - A row from priceListings.
 * @param {number} qty
 * @returns {{ unitAmount:number, netAmount:number, taxAmount:number, grossAmount:number }}
 */
const lineMoney = (pricedRow, qty) => {
  const quantity = Number(qty) > 0 ? Number(qty) : 1;
  const b = pricedRow?.TaxBreakdown;
  if (!b || !b.found) {
    return { unitAmount: 0, netAmount: 0, taxAmount: 0, grossAmount: 0 };
  }
  const unit = Number(b.unitAmount) || 0;
  return {
    unitAmount: unit,
    netAmount: round2((Number(b.netAmount) || 0) * quantity),
    taxAmount: round2((Number(b.taxAmount) || 0) * quantity),
    grossAmount: round2((Number(b.grossAmount) || 0) * quantity),
  };
};

// Money is compared and summed here, so it is rounded the way currency is —
// not left as a float that prints 1234.5600000000002 onto a bill.
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

module.exports = { resolveCostInfoId, priceListings, lineMoney, round2 };
