// src/modules/transactiontype/transactiontype.schemas.js
const Joi = require('joi');

const createTransactionTypeSchema = Joi.object({
  Name: Joi.string().required().max(100).trim(),
  Description: Joi.string().optional().max(255).trim().allow('', null),
  Active: Joi.boolean().optional().default(true),
});

const updateTransactionTypeSchema = Joi.object({
  Name: Joi.string().optional().max(100).trim(),
  Description: Joi.string().optional().max(255).trim().allow('', null),
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
  createTransactionTypeSchema,
  updateTransactionTypeSchema,
  paginationSchema,
  uuidParamSchema,
};
