// src/modules/paymentmodetransactiondetail/paymentmodetransactiondetail.schemas.js
const Joi = require('joi');

const createSchema = Joi.object({
  PaymentModeId: Joi.string().uuid().required(),
  RefNo: Joi.string().optional().max(50).trim().allow(null, ''),
  Comment: Joi.string().optional().max(100).trim().allow(null, ''),
  CF1: Joi.string().optional().max(50).trim().allow(null, ''),
  CF2: Joi.string().optional().max(50).trim().allow(null, ''),
  CF3: Joi.string().optional().max(50).trim().allow(null, ''),
  CF4: Joi.string().optional().max(50).trim().allow(null, ''),
  Active: Joi.boolean().optional().default(true),
});

const updateSchema = Joi.object({
  PaymentModeId: Joi.string().uuid().optional(),
  RefNo: Joi.string().optional().max(50).trim().allow(null, ''),
  Comment: Joi.string().optional().max(100).trim().allow(null, ''),
  CF1: Joi.string().optional().max(50).trim().allow(null, ''),
  CF2: Joi.string().optional().max(50).trim().allow(null, ''),
  CF3: Joi.string().optional().max(50).trim().allow(null, ''),
  CF4: Joi.string().optional().max(50).trim().allow(null, ''),
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
