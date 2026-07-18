// src/modules/poscustomer/poscustomer.schemas.js
// Joi validation schemas for POS Customer operations.

const Joi = require('joi');

const createSchema = Joi.object({
  Name: Joi.string().required().max(100).allow(null).trim(),
  Phone: Joi.string().optional().max(20).allow(null, '').trim(),
  Email: Joi.string().optional().max(100).allow(null, '').trim(),
  Visits: Joi.number().integer().optional().default(0).allow(null),
  TotalSpent: Joi.number().optional().default(0).allow(null),
  LoyaltyPoints: Joi.number().integer().optional().default(0).allow(null),
  BranchDetailId: Joi.string().uuid().optional().allow(null),
  Active: Joi.boolean().optional().default(true),
});

const updateSchema = Joi.object({
  Name: Joi.string().optional().max(100).allow(null, '').trim(),
  Phone: Joi.string().optional().max(20).allow(null, '').trim(),
  Email: Joi.string().optional().max(100).allow(null, '').trim(),
  Visits: Joi.number().integer().optional().allow(null),
  TotalSpent: Joi.number().optional().allow(null),
  LoyaltyPoints: Joi.number().integer().optional().allow(null),
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
