// src/modules/pricing/pricing.schemas.js
// Joi schemas for the stateless pricing quote endpoint.

const Joi = require('joi');
const { entityId } = require('../../utils/idSchema');

// Per-line selection caps. Exported, because the till's correlation key is
// BUILT from these ids and its length cap has to follow from them.
const MAX_VARIANTS_PER_LINE = 20;
// Higher than variants' because a group can legitimately offer a long toppings
// list and a dish can carry several groups.
const MAX_ADDONS_PER_LINE = 50;

/**
 * The client's correlation key for a cart line, echoed back untouched.
 *
 * Its cap is DERIVED, not picked. The till builds the key as
 * `[menuRowId, ...variantIds, ...addonIds].join('|')`, so its worst case is set
 * by the line's own selection limits above. It used to be a flat 100 — which a
 * single dish with TWO add-ons already exceeds (3 × 36 + 2 = 110), so the quote
 * was refused with a 400, the till fell back to an untaxed total, and the
 * cashier saw "Tax could not be calculated" on an ordinary order.
 *
 * The offer preview carried its own flat 120 on the same key and would have
 * failed at three add-ons. Both schemas use this now, so they cannot disagree.
 *
 * Still capped: an unbounded string is not a correlation key.
 */
const ID_MAX = 50;
// One more segment for the till's line split: the same dish with the same
// options but a DIFFERENT kitchen note is its own cart line, keyed with a short
// suffix ("|n2"). It has to fit under the cap like any id does.
const LINE_SPLIT_SEGMENTS = 1; // entityId's own limit
const LINE_REF_MAX = (1 + MAX_VARIANTS_PER_LINE + MAX_ADDONS_PER_LINE + LINE_SPLIT_SEGMENTS) * (ID_MAX + 1);
const lineRef = Joi.string().max(LINE_REF_MAX);

// Discounts are applied BEFORE tax (see TAX_ENGINE_DESIGN.md §6.2).
const discountSchema = Joi.object({
  type: Joi.string().valid('percent', 'amount').required(),
  value: Joi.number().min(0).required(),
});

const lineSchema = Joi.object({
  costInfoId: entityId.required(),
  quantity: Joi.number().min(0).default(1),
  // Selected variants. Their prices are read from the pos_variant master and
  // added to the unit price BEFORE tax — never taxed as separate lines.
  variantIds: Joi.array().items(entityId).max(MAX_VARIANTS_PER_LINE).optional(),
  // Selected add-ons, priced from the pos_addon master on the same terms.
  addonIds: Joi.array().items(entityId).max(MAX_ADDONS_PER_LINE).optional(),
  discount: discountSchema.optional().allow(null),
  // Client correlation key, echoed back untouched — see lineRef.
  ref: lineRef.optional(),
});

const quoteSchema = Joi.object({
  lines: Joi.array().items(lineSchema).min(1).max(200).required(),
  // Document-level discount, apportioned across lines before tax.
  discount: discountSchema.optional().allow(null),
});

const taxGroupParamSchema = Joi.object({
  taxGroupId: entityId.required(),
});

module.exports = {
  quoteSchema,
  taxGroupParamSchema,
  lineRef,
  LINE_REF_MAX,
  MAX_VARIANTS_PER_LINE,
  MAX_ADDONS_PER_LINE,
};
