// src/modules/paymentbreakup/paymentbreakup.schemas.js
const Joi = require('joi');

const createSchema = Joi.object({
  AccountTypeBaseId: Joi.string().uuid().required(),
  PaymentDetailId: Joi.string().uuid().required(),
  PaymentModeTransactionDetailId: Joi.string().uuid().required(),
  PaymentReceivedTypeId: Joi.string().uuid().required(),
  // Amount settled through this payment mode. Several breakups against one
  // paymentdetail make up a split settlement, and they should sum to its
  // TotalAmount.
  Amount: Joi.number().min(0).optional().default(0),
  UserId: Joi.string().uuid().optional().allow(null, ''),
  Timestamp: Joi.alternatives()
    .try(Joi.date().iso(), Joi.string().regex(/^\d{1,2}-\d{1,2}-\d{4}$/))
    .required(),
  Active: Joi.boolean().optional().default(true),
});

const updateSchema = Joi.object({
  AccountTypeBaseId: Joi.string().uuid().optional(),
  PaymentDetailId: Joi.string().uuid().optional(),
  PaymentModeTransactionDetailId: Joi.string().uuid().optional(),
  PaymentReceivedTypeId: Joi.string().uuid().optional(),
  Amount: Joi.number().min(0).optional(),
  UserId: Joi.string().uuid().optional().allow(null, ''),
  Timestamp: Joi.alternatives()
    .try(Joi.date().iso(), Joi.string().regex(/^\d{1,2}-\d{1,2}-\d{4}$/))
    .optional(),
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
