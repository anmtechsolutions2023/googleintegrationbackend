// src/modules/transactionitemdetail/transactionitemdetail.schemas.js
const Joi = require('joi');

const createSchema = Joi.object({
  TransactionDetailLogId: Joi.string().uuid().required(),
  ItemDetailId: Joi.string().uuid().required(),
  BatchDetailId: Joi.string().uuid().optional().allow(null),
  Quantity: Joi.number().precision(4).required(),
  UOMId: Joi.string().uuid().optional().allow(null),
  Rate: Joi.number().precision(4).optional().allow(null),
  Amount: Joi.number().precision(4).optional().allow(null),
  TaxGroupId: Joi.string().uuid().optional().allow(null),
  TaxAmount: Joi.number().precision(4).optional().allow(null),
  DiscountAmount: Joi.number().precision(4).optional().allow(null),
  NetAmount: Joi.number().precision(4).optional().allow(null),
  Active: Joi.boolean().optional().default(true),
});

const updateSchema = Joi.object({
  TransactionDetailLogId: Joi.string().uuid().optional(),
  ItemDetailId: Joi.string().uuid().optional(),
  BatchDetailId: Joi.string().uuid().optional().allow(null),
  Quantity: Joi.number().precision(4).optional(),
  UOMId: Joi.string().uuid().optional().allow(null),
  Rate: Joi.number().precision(4).optional().allow(null),
  Amount: Joi.number().precision(4).optional().allow(null),
  TaxGroupId: Joi.string().uuid().optional().allow(null),
  TaxAmount: Joi.number().precision(4).optional().allow(null),
  DiscountAmount: Joi.number().precision(4).optional().allow(null),
  NetAmount: Joi.number().precision(4).optional().allow(null),
  Active: Joi.boolean().optional(),
}).min(1);

const paginationSchema = Joi.object({
  page: Joi.number().integer().min(1).optional().default(1),
  limit: Joi.number().integer().min(1).max(100).optional().default(10),
});

const uuidParamSchema = Joi.object({
  id: Joi.string().uuid().required(),
});

module.exports = {
  createSchema,
  updateSchema,
  paginationSchema,
  uuidParamSchema,
};
