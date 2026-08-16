// src/modules/posbill/posbill.schemas.js
// Joi validation schemas for POS Bill operations.

const Joi = require('joi');

// Per-item discounts, keyed "<orderId>#<lineIndex>" — the same ref the settle
// quote builds for each line. Values are validated, but the keys are not
// constrained here: an unknown ref simply matches no line and is ignored when
// the bill is recomputed, which is safer than rejecting a whole settle because
// one round was deleted between quoting and paying.
const lineDiscountsSchema = Joi.object()
  .pattern(
    Joi.string().max(120),
    Joi.object({
      type: Joi.string().valid('amount', 'percent').required(),
      value: Joi.number().min(0).required(),
    }),
  )
  .max(200)
  .optional()
  .allow(null);

// BillNo is issued server-side from the POS_BILL numbering series; any value
// sent is ignored. Clients used to generate it from Date.now().
const createSchema = Joi.object({
  BillNo: Joi.string().optional().max(50).allow(null, '').trim(),
  OrderId: Joi.string().uuid().optional().allow(null),
  // A dine-in session is several rounds billed together. When present the server
  // recomputes SubTotal/TaxAmount/Total from every listed order's priced lines,
  // applying Discount BEFORE tax. OrderId alone still works for single-order bills.
  OrderIds: Joi.array().items(Joi.string().uuid()).min(1).max(100).optional(),
  SubTotal: Joi.number().optional().default(0).allow(null),
  TaxAmount: Joi.number().optional().default(0).allow(null),
  Discount: Joi.number().optional().default(0).allow(null),
  LineDiscounts: lineDiscountsSchema,
  Total: Joi.number().optional().default(0).allow(null),
  Payments: Joi.alternatives(Joi.object(), Joi.array()).optional().allow(null),
  Status: Joi.string().optional().max(20).allow(null, '').trim(),
  SettledAt: Joi.date().optional().allow(null),
  BranchDetailId: Joi.string().uuid().optional().allow(null),
  Active: Joi.boolean().optional().default(true),
});

const updateSchema = Joi.object({
  BillNo: Joi.string().optional().max(50).allow(null, '').trim(),
  OrderId: Joi.string().uuid().optional().allow(null),
  SubTotal: Joi.number().optional().allow(null),
  TaxAmount: Joi.number().optional().allow(null),
  Discount: Joi.number().optional().allow(null),
  LineDiscounts: lineDiscountsSchema,
  Total: Joi.number().optional().allow(null),
  Payments: Joi.alternatives(Joi.object(), Joi.array()).optional().allow(null),
  Status: Joi.string().optional().max(20).allow(null, '').trim(),
  SettledAt: Joi.date().optional().allow(null),
  BranchDetailId: Joi.string().uuid().optional().allow(null),
  Active: Joi.boolean().optional(),
}).min(1);

// Domain action: settle a bill. Payments is required (at least one payment line).
// One entry per way the customer paid. Each becomes a paymentbreakup row with
// its own instrument (mode + reference), which is what makes a split settlement
// reconcilable. RefNo is enforced server-side for card/UPI/wallet.
const tenderSchema = Joi.object({
  paymentModeId: Joi.string().uuid().required(),
  amount: Joi.number().min(0).required(),
  refNo: Joi.string().max(50).optional().allow(null, ''),
  comment: Joi.string().max(100).optional().allow(null, ''),
});

const settleSchema = Joi.object({
  // Preferred input.
  Tenders: Joi.array().items(tenderSchema).min(1).max(20).optional(),
  // Legacy blob — still accepted so existing callers keep settling; mapped to a
  // single tender. One of Payments/Tenders must be present.
  Payments: Joi.alternatives(Joi.object(), Joi.array()).optional(),
  Discount: Joi.number().optional().allow(null),
  LineDiscounts: lineDiscountsSchema,
  Total: Joi.number().optional().allow(null),
}).or('Tenders', 'Payments');

const paginationSchema = Joi.object({
  page: Joi.number().integer().min(1).optional().default(1),
  limit: Joi.number().integer().min(1).max(100).optional().default(10),
});

const uuidParamSchema = Joi.object({
  id: Joi.string().uuid().required(),
});

module.exports = { createSchema, updateSchema, settleSchema, paginationSchema, uuidParamSchema };
