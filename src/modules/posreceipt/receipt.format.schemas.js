// src/modules/posreceipt/receipt.format.schemas.js
// Joi validation for the receipt-format endpoints.
//
// Deliberately THIN. Joi checks the envelope — is there a branch, is the
// document type one that exists, is the body a flat map of strings — and stops
// there. Whether `taxRows` may be `split` is a question only the catalogue can
// answer, and answering it in two places is how the two answers drift apart.
// See receipt.format.service.coerce().

const Joi = require('joi');
const { DOCUMENTS, TAX_MODE } = require('./receipt.catalogue');

const branchQuerySchema = Joi.object({
  branchId: Joi.string().uuid().required(),
});

const docQuerySchema = Joi.object({
  branchId: Joi.string().uuid().required(),
  doc: Joi.string().valid(...Object.keys(DOCUMENTS)).required(),
});

// A flat map of field → value. Values arrive as strings because that is what
// pos_setting stores; a number or a boolean is coerced rather than refused, so
// a client sending `true` instead of `"always"` gets a message about the
// allowed VALUES rather than about JSON types.
const updateSchema = Joi.object({
  values: Joi.object()
    .pattern(
      Joi.string().max(60),
      Joi.alternatives().try(Joi.string().allow('').max(255), Joi.number(), Joi.boolean()),
    )
    .min(1)
    .required(),
});

const taxModeSchema = Joi.object({
  taxMode: Joi.string().valid(...Object.values(TAX_MODE)).required(),
});

module.exports = { branchQuerySchema, docQuerySchema, updateSchema, taxModeSchema };
