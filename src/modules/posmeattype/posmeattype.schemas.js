// src/modules/posmeattype/posmeattype.schemas.js
// Joi validation schemas for POS Meat Type master operations.
// Field lengths mirror pos_meat_type in 01-schema-definition.sql exactly — the
// database is the source of truth, and a Joi rule looser than its column turns
// a clear 400 into a 500 from MySQL.

const Joi = require('joi');
const { entityId } = require('../../utils/idSchema');

const createSchema = Joi.object({
  Name: Joi.string().max(100).trim().required(),
  Code: Joi.string().max(50).trim().required(),
  Description: Joi.string().max(255).trim().allow('', null).optional(),
  SortOrder: Joi.number().integer().optional().default(0),
  Active: Joi.boolean().optional().default(true),
});

const updateSchema = Joi.object({
  Name: Joi.string().max(100).trim().optional(),
  Code: Joi.string().max(50).trim().optional(),
  Description: Joi.string().max(255).trim().allow('', null).optional(),
  SortOrder: Joi.number().integer().optional(),
  Active: Joi.boolean().optional(),
}).min(1);

const paginationSchema = Joi.object({
  page: Joi.number().integer().min(1).optional().default(1),
  limit: Joi.number().integer().min(1).max(100).optional().default(10),
});

const uuidParamSchema = Joi.object({
  id: entityId.required(),
});

module.exports = { createSchema, updateSchema, paginationSchema, uuidParamSchema };
