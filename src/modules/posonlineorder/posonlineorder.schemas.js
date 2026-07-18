// src/modules/posonlineorder/posonlineorder.schemas.js
// Joi validation schemas for POS Online Order operations.

const Joi = require('joi');

const createSchema = Joi.object({
  Platform: Joi.string().required().max(50).allow(null).trim(),
  ExternalRef: Joi.string().optional().max(100).allow(null, '').trim(),
  Status: Joi.string().optional().max(20).allow(null, '').trim(),
  Payload: Joi.alternatives(Joi.object(), Joi.array()).optional().allow(null),
  BranchDetailId: Joi.string().uuid().optional().allow(null),
  Active: Joi.boolean().optional().default(true),
});

const updateSchema = Joi.object({
  Platform: Joi.string().optional().max(50).allow(null, '').trim(),
  ExternalRef: Joi.string().optional().max(100).allow(null, '').trim(),
  Status: Joi.string().optional().max(20).allow(null, '').trim(),
  Payload: Joi.alternatives(Joi.object(), Joi.array()).optional().allow(null),
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
