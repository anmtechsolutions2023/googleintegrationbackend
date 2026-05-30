// src/modules/transactiontype/transactiontype.schemas.js
const Joi = require('joi');

const createTransactionTypeSchema = Joi.object({
  Name: Joi.string().required().max(100).trim(),
  TransactionTypeConfigId: Joi.string().uuid().required(),
  Active: Joi.boolean().optional().default(true),
});

const updateTransactionTypeSchema = Joi.object({
  Name: Joi.string().optional().max(100).trim(),
  TransactionTypeConfigId: Joi.string().uuid().optional(),
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
  createTransactionTypeSchema,
  updateTransactionTypeSchema,
  paginationSchema,
  uuidParamSchema,
  getByIdQuerySchema,
};
