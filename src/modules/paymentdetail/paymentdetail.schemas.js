// src/modules/paymentdetail/paymentdetail.schemas.js
const Joi = require('joi');

const createSchema = Joi.object({
  PaymentReceivedTypeId: Joi.string().uuid().required(),
  TransactionDetailLogId: Joi.string().uuid().required(),
  Amount: Joi.number().precision(4).required(),
  PaymentDate: Joi.date().optional().allow(null),
  ReferenceNo: Joi.string().optional().max(100).trim().allow(null, ''),
  Remarks: Joi.string().optional().max(500).trim().allow(null, ''),
  Active: Joi.boolean().optional().default(true),
});

const updateSchema = Joi.object({
  PaymentReceivedTypeId: Joi.string().uuid().optional(),
  TransactionDetailLogId: Joi.string().uuid().optional(),
  Amount: Joi.number().precision(4).optional(),
  PaymentDate: Joi.date().optional().allow(null),
  ReferenceNo: Joi.string().optional().max(100).trim().allow(null, ''),
  Remarks: Joi.string().optional().max(500).trim().allow(null, ''),
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
