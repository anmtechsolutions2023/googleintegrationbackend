// src/modules/pricing/pricing.service.js
// The project-wide entry point for "what does this cost, including tax".
//
// Everything that needs a price goes through here so the settled policy lives in
// exactly one place (see TAX_ENGINE_DESIGN.md §6):
//   * discount applied BEFORE tax
//   * tax rounded per line, then summed
//   * components allocated so they sum exactly to the line's tax
//
// IMPORTANT — snapshot on write, never recompute on read. Callers persisting a
// document (order, bill, invoice) must store what this returns. Historical rows
// must never be re-priced against today's rates.

const {
  computeTax,
  sumLines,
  toMinor,
  fromMinor,
  allocate,
  discountMinorFor,
} = require('../../utils/taxCalculator');
const repository = require('./pricing.repository');
const itemMetaRepository = require('../positemmeta/positemmeta.repository');

/** Shape returned for a costinfo that could not be resolved. */
const missingBreakdown = (costInfoId) => ({
  costInfoId,
  found: false,
  taxGroupId: null,
  taxGroupName: null,
  ...computeTax({ amount: 0, components: [] }),
});

/**
 * Prices a set of costinfo records — the primitive every other helper builds on.
 * @param {string[]} costInfoIds
 * @param {string} tenantId
 * @returns {Promise<Map<string, Object>>} costInfoId → breakdown
 */
const priceCostInfos = async (costInfoIds, tenantId) => {
  const chain = await repository.getChainForCostInfos(costInfoIds, tenantId);
  const result = new Map();

  [...new Set((costInfoIds || []).filter(Boolean))].forEach((id) => {
    const entry = chain.get(id);
    if (!entry) {
      result.set(id, missingBreakdown(id));
      return;
    }
    result.set(id, {
      costInfoId: id,
      found: true,
      taxGroupId: entry.taxGroupId,
      taxGroupName: entry.taxGroupName,
      ...computeTax({
        amount: entry.amount,
        isTaxIncluded: entry.isTaxIncluded,
        components: entry.components,
      }),
    });
  });

  return result;
};

/**
 * Spreads a document-level discount across lines in proportion to their value.
 *
 * Needed because tax is per line but the discount is entered once for the whole
 * document. Uses the same largest-remainder allocator as the component split, so
 * the per-line discounts always sum back to the document discount exactly.
 *
 * @param {Array<{weightMinor:number}>} weightedLines
 * @param {number} discountMinor
 * @returns {number[]} Per-line discount in minor units.
 */
const apportionDiscount = (weightedLines, discountMinor) => {
  if (!discountMinor) return weightedLines.map(() => 0);
  const weights = weightedLines.map((l) => l.weightMinor);
  const total = weights.reduce((s, w) => s + w, 0);
  // Cap at the document value — a discount cannot exceed what is being sold.
  return allocate(Math.min(discountMinor, total), weights);
};

/**
 * Prices a document's lines and returns per-line breakdowns plus totals.
 *
 * @param {Array<Object>} lines - [{ costInfoId, quantity, discount?, ...passthrough }]
 * @param {string} tenantId
 * @param {Object} [options]
 * @param {Object} [options.discount] - Document-level discount, applied before tax.
 * @returns {Promise<Object>} { lines: [...], totals: {...} }
 */
const priceLines = async (lines, tenantId, options = {}) => {
  const input = Array.isArray(lines) ? lines : [];
  if (input.length === 0) {
    return { lines: [], totals: sumLines([]) };
  }

  // Both lookups are batched, so a whole cart costs two queries regardless of
  // how many lines or variants it has.
  const [chain, variants] = await Promise.all([
    repository.getChainForCostInfos(input.map((l) => l.costInfoId), tenantId),
    itemMetaRepository.getVariantPricesByIds(
      input.flatMap((l) => l.variantIds || []),
      tenantId,
    ),
  ]);

  /**
   * Selected variants for a line, resolved to master name + price. Unknown or
   * inactive ids simply drop out rather than failing the whole quote.
   */
  const resolveVariants = (line) =>
    (line.variantIds || [])
      .map((id) => variants.get(id))
      .filter(Boolean);

  // Pass 1 — resolve each line's value net of its OWN discount. That value is
  // the weight used to spread the document discount, so a bigger line absorbs a
  // proportionally bigger share of it.
  const prepared = input.map((line) => {
    const entry = chain.get(line.costInfoId);
    const quantity = Number(line.quantity ?? 1) || 0;
    const selectedVariants = resolveVariants(line);
    // Variants are a flat surcharge on the unit price — never taxed separately.
    const addOnMinor = selectedVariants.reduce((sum, v) => sum + toMinor(v.price), 0);
    const unitMinor = entry ? toMinor(entry.amount) + addOnMinor : 0;
    const lineMinor = Math.round(unitMinor * quantity);
    const lineDiscountMinor = discountMinorFor(lineMinor, line.discount);
    return {
      line,
      entry,
      quantity,
      selectedVariants,
      addOn: fromMinor(addOnMinor),
      lineDiscountMinor,
      weightMinor: lineMinor - lineDiscountMinor,
    };
  });

  const subtotalMinor = prepared.reduce((sum, p) => sum + p.weightMinor, 0);
  const docDiscountMinor = discountMinorFor(subtotalMinor, options.discount);
  const perLineDocDiscount = apportionDiscount(prepared, docDiscountMinor);

  // Pass 2 — price each line once, with both discounts folded into a single
  // flat amount so computeTax applies the whole reduction before tax.
  const pricedLines = prepared.map((p, index) => {
    const totalDiscountMinor = p.lineDiscountMinor + perLineDocDiscount[index];
    const breakdown = computeTax({
      amount: p.entry ? p.entry.amount : 0,
      isTaxIncluded: p.entry ? p.entry.isTaxIncluded : false,
      components: p.entry ? p.entry.components : [],
      quantity: p.quantity,
      addOn: p.addOn,
      discount: totalDiscountMinor
        ? { type: 'amount', value: fromMinor(totalDiscountMinor) }
        : null,
    });

    return {
      ...p.line,
      costInfoId: p.line.costInfoId ?? null,
      found: !!p.entry,
      taxGroupId: p.entry ? p.entry.taxGroupId : null,
      taxGroupName: p.entry ? p.entry.taxGroupName : null,
      // Resolved from the master so the caller can render "Large +₹30" without
      // a second lookup, and so an order stores what was actually charged.
      variants: p.selectedVariants,
      ...breakdown,
      // Kept apart so a bill can show "₹20 off this dish" separately from
      // "this dish's share of the 10% off the bill". `discountAmount` remains
      // the total borne by the line.
      itemDiscountAmount: fromMinor(p.lineDiscountMinor),
      billDiscountAmount: fromMinor(perLineDocDiscount[index]),
    };
  });

  return { lines: pricedLines, totals: sumLines(pricedLines) };
};

/**
 * Re-prices lines that already carry their own rates — NO database access.
 *
 * This is how a bill is assembled from the rounds it covers. The orders already
 * hold a snapshot taken when they were placed, so the bill must re-apply the
 * discount against THOSE rates, not against whatever the tax group says today.
 * Re-reading the chain here would silently re-price a settled session if someone
 * edited a tax group between ordering and settling.
 *
 * `unitAmount` is the EFFECTIVE unit price the order recorded — variants are
 * already folded into it — so no variant lookup happens here either.
 *
 * @param {Array<Object>} lines - [{ unitAmount, quantity, isTaxIncluded, components:[{name,rate}], discount? }]
 * @param {Object} [options]
 * @param {Object} [options.discount] - Document-level discount, applied before tax.
 * @returns {Object} { lines, totals } — same shape as priceLines.
 */
const priceSnapshotLines = (lines, options = {}) => {
  const input = Array.isArray(lines) ? lines : [];
  if (input.length === 0) return { lines: [], totals: sumLines([]) };

  const prepared = input.map((line) => {
    const quantity = Number(line.quantity ?? 1) || 0;
    const lineMinor = Math.round(toMinor(line.unitAmount) * quantity);
    const lineDiscountMinor = discountMinorFor(lineMinor, line.discount);
    return { line, quantity, lineDiscountMinor, weightMinor: lineMinor - lineDiscountMinor };
  });

  const subtotalMinor = prepared.reduce((sum, p) => sum + p.weightMinor, 0);
  const docDiscountMinor = discountMinorFor(subtotalMinor, options.discount);
  const perLineDocDiscount = apportionDiscount(prepared, docDiscountMinor);

  const pricedLines = prepared.map((p, index) => {
    const totalDiscountMinor = p.lineDiscountMinor + perLineDocDiscount[index];
    const breakdown = computeTax({
      amount: p.line.unitAmount,
      isTaxIncluded: !!p.line.isTaxIncluded,
      components: p.line.components || [],
      quantity: p.quantity,
      discount: totalDiscountMinor
        ? { type: 'amount', value: fromMinor(totalDiscountMinor) }
        : null,
    });
    return {
      ...p.line,
      ...breakdown,
      // The two kinds of discount are reported separately — "we discounted this
      // dish" and "this dish absorbed part of a bill discount" are different
      // facts, and merging them makes it impossible to answer which products we
      // actually give away. `discountAmount` (from computeTax) stays the total
      // borne by the line, so the SUM(line) = document invariant is untouched.
      itemDiscountAmount: fromMinor(p.lineDiscountMinor),
      billDiscountAmount: fromMinor(perLineDocDiscount[index]),
    };
  });

  return { lines: pricedLines, totals: sumLines(pricedLines) };
};

/**
 * Effective rate + components for one tax group — for UI display.
 * @param {string} taxGroupId
 * @param {string} tenantId
 * @returns {Promise<Object|null>}
 */
const getTaxGroupRate = async (taxGroupId, tenantId) => {
  const group = await repository.getTaxGroupComponents(taxGroupId, tenantId);
  if (!group) return null;
  const effectiveRate = group.components.reduce(
    (sum, c) => sum + toMinor(c.rate) / 100,
    0,
  );
  return {
    ...group,
    components: group.components.map((c) => ({ ...c, rate: toMinor(c.rate) / 100 })),
    effectiveRate: Number(effectiveRate.toFixed(2)),
  };
};

module.exports = {
  priceCostInfos,
  priceLines,
  priceSnapshotLines,
  getTaxGroupRate,
};
