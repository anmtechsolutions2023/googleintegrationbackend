// src/modules/transactionitemdetail/transactionitemdetail.schemas.js
const Joi = require('joi');

// Quantity is the only pricing input a caller supplies — the server resolves the
// price and tax from the item's own cost record and stores a snapshot. The
// amount fields below are computed server-side; they are accepted (so a client
// may echo a GET response back) but always overwritten.
const createSchema = Joi.object({
  TransactionDetailLogId: Joi.string().uuid().required(),
  ItemId: Joi.string().uuid().required(),
  Quantity: Joi.number().min(0).optional().default(1),
  CostInfoId: Joi.string().uuid().optional().allow(null),
  UnitPrice: Joi.any().optional().strip(),
  NetAmount: Joi.any().optional().strip(),
  TaxAmount: Joi.any().optional().strip(),
  GrossAmount: Joi.any().optional().strip(),
  TaxComponents: Joi.any().optional().strip(),
  Comment: Joi.string().optional().max(100).trim().allow(null, ''),
  Active: Joi.boolean().optional().default(true),
});

const updateSchema = Joi.object({
  TransactionDetailLogId: Joi.string().uuid().optional(),
  ItemId: Joi.string().uuid().optional(),
  Quantity: Joi.number().min(0).optional(),
  CostInfoId: Joi.string().uuid().optional().allow(null),
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
  id: Joi.string().uuid().required(),
});

module.exports = {
  createSchema,
  updateSchema,
  paginationSchema,
  uuidParamSchema,
  getByIdQuerySchema,
};
