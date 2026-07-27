// src/modules/pricing/pricing.schemas.js
// Joi schemas for the stateless pricing quote endpoint.

const Joi = require('joi');

// Discounts are applied BEFORE tax (see TAX_ENGINE_DESIGN.md §6.2).
const discountSchema = Joi.object({
  type: Joi.string().valid('percent', 'amount').required(),
  value: Joi.number().min(0).required(),
});

const lineSchema = Joi.object({
  costInfoId: Joi.string().uuid().required(),
  quantity: Joi.number().min(0).default(1),
  // Selected variants. Their prices are read from the pos_variant master and
  // added to the unit price BEFORE tax — never taxed as separate lines.
  variantIds: Joi.array().items(Joi.string().uuid()).max(20).optional(),
  discount: discountSchema.optional().allow(null),
  // Free-form client correlation key, echoed back untouched.
  ref: Joi.string().max(100).optional(),
});

const quoteSchema = Joi.object({
  lines: Joi.array().items(lineSchema).min(1).max(200).required(),
  // Document-level discount, apportioned across lines before tax.
  discount: discountSchema.optional().allow(null),
});

const taxGroupParamSchema = Joi.object({
  taxGroupId: Joi.string().uuid().required(),
});

module.exports = { quoteSchema, taxGroupParamSchema };
