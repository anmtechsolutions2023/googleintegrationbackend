// src/modules/paymentdetail/paymentdetail.schemas.js
const Joi = require('joi');

const createSchema = Joi.object({
  AccountTypeBaseId: Joi.string().uuid().required(),
  TransactionDetailLogId: Joi.string().uuid().required(),
  TotalAmount: Joi.string().required().max(50),
  GrossAmount: Joi.string().required().max(50),
  DiscountAmount: Joi.string().optional().max(100).allow(null, ''),
  RoundOff: Joi.string().optional().max(50).allow(null, ''),
  TaxesAmount: Joi.string().optional().max(50).allow(null, ''),
  UserId: Joi.string().uuid().optional().allow(null, ''),
  Active: Joi.boolean().optional().default(true),
});

const updateSchema = Joi.object({
  AccountTypeBaseId: Joi.string().uuid().optional(),
  TransactionDetailLogId: Joi.string().uuid().optional(),
  TotalAmount: Joi.string().optional().max(50),
  GrossAmount: Joi.string().optional().max(50),
  DiscountAmount: Joi.string().optional().max(100).allow(null, ''),
  RoundOff: Joi.string().optional().max(50).allow(null, ''),
  TaxesAmount: Joi.string().optional().max(50).allow(null, ''),
  UserId: Joi.string().uuid().optional().allow(null, ''),
  Active: Joi.boolean().optional(),
}).min(1);

const paginationSchema = Joi.object({
  page: Joi.number().integer().min(1).optional().default(1),
  limit: Joi.number().integer().min(1).max(100).optional().default(10),
  expand: Joi.boolean().optional().default(false),
});

const uuidParamSchema = Joi.object({
  id: Joi.string().uuid().required(),
});

const getByIdQuerySchema = Joi.object({
  expand: Joi.boolean().optional().default(false),
});

module.exports = {
  createSchema,
  updateSchema,
  paginationSchema,
  uuidParamSchema,
  getByIdQuerySchema,
};
