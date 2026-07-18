// src/modules/posexpense/posexpense.schemas.js
// Joi validation schemas for POS Expense operations.

const Joi = require('joi');

const createSchema = Joi.object({
  Category: Joi.string().required().max(100).allow(null).trim(),
  Description: Joi.string().optional().max(500).allow(null, '').trim(),
  Amount: Joi.number().required().allow(null),
  ExpenseDate: Joi.date().optional().allow(null),
  BranchDetailId: Joi.string().uuid().optional().allow(null),
  Active: Joi.boolean().optional().default(true),
});

const updateSchema = Joi.object({
  Category: Joi.string().optional().max(100).allow(null, '').trim(),
  Description: Joi.string().optional().max(500).allow(null, '').trim(),
  Amount: Joi.number().optional().allow(null),
  ExpenseDate: Joi.date().optional().allow(null),
  BranchDetailId: Joi.string().uuid().optional().allow(null),
  Active: Joi.boolean().optional(),
}).min(1);

const paginationSchema = Joi.object({
  page: Joi.number().integer().min(1).optional().default(1),
  limit: Joi.number().integer().min(1).max(100).optional().default(10),
});

const uuidParamSchema = Joi.object({
  id: Joi.string().uuid().required(),
});

module.exports = { createSchema, updateSchema, paginationSchema, uuidParamSchema };
