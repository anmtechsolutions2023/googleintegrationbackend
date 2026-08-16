// src/modules/expensecategory/expensecategory.schemas.js
// Joi validation schemas for the expense category master.

const Joi = require('joi');

const createSchema = Joi.object({
  Name: Joi.string().max(100).required().trim(),
  AccountTypeBaseId: Joi.string().uuid().optional().allow(null),
  Active: Joi.boolean().optional().default(true),
});

const updateSchema = Joi.object({
  Name: Joi.string().max(100).optional().trim(),
  AccountTypeBaseId: Joi.string().uuid().optional().allow(null),
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
