// src/modules/transactiontypebaseconversion/transactiontypebaseconversion.schemas.js
const Joi = require('joi');

const createSchema = Joi.object({
  TransactionTypeConfigId: Joi.string().uuid().required(),
  FromTransactionTypeStatusId: Joi.string().uuid().required(),
  ToTransactionTypeStatusId: Joi.string().uuid().required(),
  Active: Joi.boolean().optional().default(true),
});

const updateSchema = Joi.object({
  TransactionTypeConfigId: Joi.string().uuid().optional(),
  FromTransactionTypeStatusId: Joi.string().uuid().optional(),
  ToTransactionTypeStatusId: Joi.string().uuid().optional(),
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
