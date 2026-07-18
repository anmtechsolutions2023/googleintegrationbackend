// src/modules/postable/postable.schemas.js
// Joi validation schemas for POS Table operations.

const Joi = require('joi');

const createSchema = Joi.object({
  Name: Joi.string().required().max(50).allow(null).trim(),
  FloorId: Joi.string().uuid().optional().allow(null),
  Capacity: Joi.number().integer().optional().allow(null),
  Status: Joi.string().optional().max(20).allow(null, '').trim(),
  CurrentOrderId: Joi.string().uuid().optional().allow(null),
  BranchDetailId: Joi.string().uuid().optional().allow(null),
  Active: Joi.boolean().optional().default(true),
});

const updateSchema = Joi.object({
  Name: Joi.string().optional().max(50).allow(null, '').trim(),
  FloorId: Joi.string().uuid().optional().allow(null),
  Capacity: Joi.number().integer().optional().allow(null),
  Status: Joi.string().optional().max(20).allow(null, '').trim(),
  CurrentOrderId: Joi.string().uuid().optional().allow(null),
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
