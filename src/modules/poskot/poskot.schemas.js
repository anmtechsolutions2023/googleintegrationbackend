// src/modules/poskot/poskot.schemas.js
// Joi validation schemas for POS KOT operations.

const Joi = require('joi');

const createSchema = Joi.object({
  KotNo: Joi.string().required().max(50).allow(null).trim(),
  OrderId: Joi.string().uuid().optional().allow(null),
  TableId: Joi.string().uuid().optional().allow(null),
  Items: Joi.alternatives(Joi.object(), Joi.array()).optional().allow(null),
  Status: Joi.string().optional().max(20).allow(null, '').trim(),
  FiredAt: Joi.date().optional().allow(null),
  BranchDetailId: Joi.string().uuid().optional().allow(null),
  Active: Joi.boolean().optional().default(true),
});

const updateSchema = Joi.object({
  KotNo: Joi.string().optional().max(50).allow(null, '').trim(),
  OrderId: Joi.string().uuid().optional().allow(null),
  TableId: Joi.string().uuid().optional().allow(null),
  Items: Joi.alternatives(Joi.object(), Joi.array()).optional().allow(null),
  Status: Joi.string().optional().max(20).allow(null, '').trim(),
  FiredAt: Joi.date().optional().allow(null),
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
