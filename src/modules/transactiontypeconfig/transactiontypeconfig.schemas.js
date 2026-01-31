// src/modules/transactiontypeconfig/transactiontypeconfig.schemas.js
// Joi validation schemas for Transaction Type Config operations

const Joi = require('joi');

const createTransactionTypeConfigSchema = Joi.object({
  StartCounterNo: Joi.number().integer().min(0).required(),
  Prefix: Joi.string().max(50).trim().allow('').optional(),
  Format: Joi.string().max(100).trim().required(),
  Active: Joi.boolean().optional().default(true),
});

const updateTransactionTypeConfigSchema = Joi.object({
  StartCounterNo: Joi.number().integer().min(0).optional(),
  Prefix: Joi.string().max(50).trim().allow('').optional(),
  Format: Joi.string().max(100).trim().optional(),
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
  createTransactionTypeConfigSchema,
  updateTransactionTypeConfigSchema,
  paginationSchema,
  uuidParamSchema,
};
