// src/modules/transactiontype/transactiontype.schemas.js
const Joi = require('joi');
const { entityId } = require('../../utils/idSchema');
const { joinedEchoes } = require('../../utils/joinedEchoes');
const { QUERIES } = require('../../config/constants');

const createTransactionTypeSchema = Joi.object({
  // Every alias this module's SELECT joins in, accepted and dropped. An edit
  // form is seeded from a GET and sends the whole row back, so a joined column
  // would otherwise be rejected as an unknown key and refuse the whole save.
  // First in the literal, so the real rules below override any alias that is
  // also a genuine input.
  ...joinedEchoes(QUERIES.TRANSACTION_TYPE),
  Name: Joi.string().required().max(100).trim(),
  TransactionTypeConfigId: entityId.required(),
  Active: Joi.boolean().optional().default(true),
});

const updateTransactionTypeSchema = Joi.object({
  // Every alias this module's SELECT joins in, accepted and dropped. An edit
  // form is seeded from a GET and sends the whole row back, so a joined column
  // would otherwise be rejected as an unknown key and refuse the whole save.
  // First in the literal, so the real rules below override any alias that is
  // also a genuine input.
  ...joinedEchoes(QUERIES.TRANSACTION_TYPE),
  Name: Joi.string().optional().max(100).trim(),
  TransactionTypeConfigId: entityId.optional(),
  Active: Joi.boolean().optional(),
}).min(1);

const paginationSchema = Joi.object({
  page: Joi.number().integer().min(1).optional().default(1),
  limit: Joi.number().integer().min(1).max(100).optional().default(10),
  expand: Joi.boolean().optional().default(false),
});

const uuidParamSchema = Joi.object({
  id: entityId.required(),
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
