// src/modules/posexpense/posexpense.schemas.js
// Joi validation schemas for POS Expense operations.
//
// Status is deliberately NOT accepted on create or update: it moves only through
// the approve / reject / settle actions, so the approval gate cannot be skipped
// by posting a status straight from the client.

const Joi = require('joi');

const createSchema = Joi.object({
  ExpenseCategoryId: Joi.string().uuid().required(),
  Description: Joi.string().optional().max(500).allow(null, '').trim(),
  // Positive: a negative expense is a refund, which is a reversal, not an entry.
  Amount: Joi.number().positive().required(),
  ExpenseDate: Joi.date().optional().allow(null),
  PaymentModeId: Joi.string().uuid().optional().allow(null),
  BranchDetailId: Joi.string().uuid().optional().allow(null),
  Active: Joi.boolean().optional().default(true),
});

const updateSchema = Joi.object({
  ExpenseCategoryId: Joi.string().uuid().optional(),
  Description: Joi.string().optional().max(500).allow(null, '').trim(),
  Amount: Joi.number().positive().optional(),
  ExpenseDate: Joi.date().optional().allow(null),
  PaymentModeId: Joi.string().uuid().optional().allow(null),
  BranchDetailId: Joi.string().uuid().optional().allow(null),
  Active: Joi.boolean().optional(),
}).min(1);

/** Settling may name the mode the money actually left by. */
const settleSchema = Joi.object({
  PaymentModeId: Joi.string().uuid().optional().allow(null),
});

const paginationSchema = Joi.object({
  page: Joi.number().integer().min(1).optional().default(1),
  limit: Joi.number().integer().min(1).max(100).optional().default(10),
});

const uuidParamSchema = Joi.object({
  id: Joi.string().uuid().required(),
});

module.exports = {
  createSchema,
  updateSchema,
  settleSchema,
  paginationSchema,
  uuidParamSchema,
};
