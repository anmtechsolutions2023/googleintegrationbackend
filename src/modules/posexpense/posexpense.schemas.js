// src/modules/posexpense/posexpense.schemas.js
// Joi validation schemas for POS Expense operations.
//
// Status is deliberately NOT accepted on create or update: it moves only through
// the approve / reject / settle actions, so the approval gate cannot be skipped
// by posting a status straight from the client.

const Joi = require('joi');
const { entityId, optionalEntityId } = require('../../utils/idSchema');
const { joinedEchoes } = require('../../utils/joinedEchoes');
const { QUERIES } = require('../../config/constants');

const createSchema = Joi.object({
  // Every alias this module's SELECT joins in, accepted and dropped. An edit
  // form is seeded from a GET and sends the whole row back, so a joined column
  // would otherwise be rejected as an unknown key and refuse the whole save.
  // First in the literal, so the real rules below override any alias that is
  // also a genuine input.
  ...joinedEchoes(QUERIES.POS_EXPENSE),
  ExpenseCategoryId: entityId.required(),
  Description: Joi.string().optional().max(500).allow(null, '').trim(),
  // Positive: a negative expense is a refund, which is a reversal, not an entry.
  Amount: Joi.number().positive().required(),
  ExpenseDate: Joi.date().optional().allow(null),
  PaymentModeId: optionalEntityId,
  BranchDetailId: optionalEntityId,
  Active: Joi.boolean().optional().default(true),
});

const updateSchema = Joi.object({
  // Every alias this module's SELECT joins in, accepted and dropped. An edit
  // form is seeded from a GET and sends the whole row back, so a joined column
  // would otherwise be rejected as an unknown key and refuse the whole save.
  // First in the literal, so the real rules below override any alias that is
  // also a genuine input.
  ...joinedEchoes(QUERIES.POS_EXPENSE),
  ExpenseCategoryId: entityId.optional(),
  Description: Joi.string().optional().max(500).allow(null, '').trim(),
  Amount: Joi.number().positive().optional(),
  ExpenseDate: Joi.date().optional().allow(null),
  PaymentModeId: optionalEntityId,
  BranchDetailId: optionalEntityId,
  Active: Joi.boolean().optional(),
}).min(1);

/** Settling may name the mode the money actually left by. */
const settleSchema = Joi.object({
  PaymentModeId: optionalEntityId,
});

const paginationSchema = Joi.object({
  page: Joi.number().integer().min(1).optional().default(1),
  limit: Joi.number().integer().min(1).max(100).optional().default(10),
});

const uuidParamSchema = Joi.object({
  id: entityId.required(),
});

module.exports = {
  createSchema,
  updateSchema,
  settleSchema,
  paginationSchema,
  uuidParamSchema,
};
