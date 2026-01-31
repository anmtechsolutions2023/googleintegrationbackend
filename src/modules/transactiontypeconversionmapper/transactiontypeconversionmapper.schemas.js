// src/modules/transactiontypeconversionmapper/transactiontypeconversionmapper.schemas.js
const Joi = require('joi');

const createSchema = Joi.object({
  TransactionTypeBaseConversionId: Joi.string().uuid().required(),
  FromTransactionDetailLogId: Joi.string().uuid().required(),
  ToTransactionDetailLogId: Joi.string().uuid().required(),
  Active: Joi.boolean().optional().default(true),
});

const updateSchema = Joi.object({
  TransactionTypeBaseConversionId: Joi.string().uuid().optional(),
  FromTransactionDetailLogId: Joi.string().uuid().optional(),
  ToTransactionDetailLogId: Joi.string().uuid().optional(),
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
