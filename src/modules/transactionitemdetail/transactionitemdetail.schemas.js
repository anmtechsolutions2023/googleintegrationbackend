// src/modules/transactionitemdetail/transactionitemdetail.schemas.js
const Joi = require('joi');

const createSchema = Joi.object({
  TransactionDetailLogId: Joi.string().uuid().required(),
  ItemId: Joi.string().uuid().required(),
  Comment: Joi.string().optional().max(100).trim().allow(null, ''),
  Active: Joi.boolean().optional().default(true),
});

const updateSchema = Joi.object({
  TransactionDetailLogId: Joi.string().uuid().optional(),
  ItemId: Joi.string().uuid().optional(),
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
