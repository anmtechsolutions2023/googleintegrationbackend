// src/modules/posvariant/posvariant.schemas.js
// Joi validation schemas for POS Variant master operations.

const Joi = require('joi');

const createSchema = Joi.object({
  Name: Joi.string().max(100).trim().required(),
  Code: Joi.string().max(50).trim().required(),
  Description: Joi.string().max(255).trim().allow('', null).optional(),
  SortOrder: Joi.number().integer().optional().default(0),
  Price: Joi.number().optional().allow(null),
  Active: Joi.boolean().optional().default(true),
});

const updateSchema = Joi.object({
  Name: Joi.string().max(100).trim().optional(),
  Code: Joi.string().max(50).trim().optional(),
  Description: Joi.string().max(255).trim().allow('', null).optional(),
  SortOrder: Joi.number().integer().optional(),
  Price: Joi.number().optional().allow(null),
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
