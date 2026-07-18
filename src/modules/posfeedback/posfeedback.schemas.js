// src/modules/posfeedback/posfeedback.schemas.js
// Joi validation schemas for POS Feedback operations.

const Joi = require('joi');

const createSchema = Joi.object({
  CustomerId: Joi.string().uuid().optional().allow(null),
  CustomerName: Joi.string().optional().max(100).allow(null, '').trim(),
  Rating: Joi.number().integer().min(1).max(5).required(),
  Comments: Joi.string().optional().max(1000).allow(null, '').trim(),
  BranchDetailId: Joi.string().uuid().optional().allow(null),
  Active: Joi.boolean().optional().default(true),
});

const updateSchema = Joi.object({
  CustomerId: Joi.string().uuid().optional().allow(null),
  CustomerName: Joi.string().optional().max(100).allow(null, '').trim(),
  Rating: Joi.number().integer().optional().allow(null),
  Comments: Joi.string().optional().max(1000).allow(null, '').trim(),
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
