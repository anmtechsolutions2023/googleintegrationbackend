// src/modules/transactionitemdetail/transactionitemdetail.schemas.js
const Joi = require('joi');
const { entityId, optionalEntityId } = require('../../utils/idSchema');
const { joinedEchoes } = require('../../utils/joinedEchoes');
const { QUERIES } = require('../../config/constants');

// Quantity is the only pricing input a caller supplies — the server resolves the
// price and tax from the item's own cost record and stores a snapshot. The
// amount fields below are computed server-side; they are accepted (so a client
// may echo a GET response back) but always overwritten.
const createSchema = Joi.object({
  // Every alias this module's SELECT joins in, accepted and dropped. An edit
  // form is seeded from a GET and sends the whole row back, so a joined column
  // would otherwise be rejected as an unknown key and refuse the whole save.
  // First in the literal, so the real rules below override any alias that is
  // also a genuine input.
  ...joinedEchoes(QUERIES.TRANSACTION_ITEM_DETAIL),
  TransactionDetailLogId: entityId.required(),
  ItemId: entityId.required(),
  Quantity: Joi.number().min(0).optional().default(1),
  CostInfoId: optionalEntityId,
  UnitPrice: Joi.any().optional().strip(),
  NetAmount: Joi.any().optional().strip(),
  TaxAmount: Joi.any().optional().strip(),
  GrossAmount: Joi.any().optional().strip(),
  TaxComponents: Joi.any().optional().strip(),
  Comment: Joi.string().optional().max(100).trim().allow(null, ''),
  Active: Joi.boolean().optional().default(true),
});

const updateSchema = Joi.object({
  // Every alias this module's SELECT joins in, accepted and dropped. An edit
  // form is seeded from a GET and sends the whole row back, so a joined column
  // would otherwise be rejected as an unknown key and refuse the whole save.
  // First in the literal, so the real rules below override any alias that is
  // also a genuine input.
  ...joinedEchoes(QUERIES.TRANSACTION_ITEM_DETAIL),
  TransactionDetailLogId: entityId.optional(),
  ItemId: entityId.optional(),
  Quantity: Joi.number().min(0).optional(),
  CostInfoId: optionalEntityId,
  UnitPrice: Joi.any().optional().strip(),
  NetAmount: Joi.any().optional().strip(),
  TaxAmount: Joi.any().optional().strip(),
  GrossAmount: Joi.any().optional().strip(),
  TaxComponents: Joi.any().optional().strip(),
  Comment: Joi.string().optional().max(100).trim().allow(null, ''),
  Active: Joi.boolean().optional(),
}).min(1);

const paginationSchema = Joi.object({
  page: Joi.number().integer().min(1).optional().default(1),
  limit: Joi.number().integer().min(1).max(100).optional().default(10),
  expand: Joi.boolean().optional().default(false),
});

const getByIdQuerySchema = Joi.object({
  expand: Joi.boolean().optional().default(false),
});

const uuidParamSchema = Joi.object({
  id: entityId.required(),
});

module.exports = {
  createSchema,
  updateSchema,
  paginationSchema,
  uuidParamSchema,
  getByIdQuerySchema,
};
