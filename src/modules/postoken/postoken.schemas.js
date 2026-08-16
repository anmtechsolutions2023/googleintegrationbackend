// src/modules/postoken/postoken.schemas.js
// Joi validation schemas for POS Token operations.

const Joi = require('joi');
const { POS_TOKEN_STATUSES } = require('../../config/constants');

// Canonical lowercase enum, normalized on write. Status was free text, so
// 'Waiting' and 'waiting' could both be stored and every reader had to guess.
const statusField = Joi.string().lowercase().valid(...POS_TOKEN_STATUSES);

const createSchema = Joi.object({
  TokenNumber: Joi.number().integer().required().allow(null),
  OrderId: Joi.string().uuid().optional().allow(null),
  Status: statusField.optional().allow(null, '').default('waiting'),
  BranchDetailId: Joi.string().uuid().optional().allow(null),
  Active: Joi.boolean().optional().default(true),
});

const updateSchema = Joi.object({
  TokenNumber: Joi.number().integer().optional().allow(null),
  OrderId: Joi.string().uuid().optional().allow(null),
  Status: statusField.optional().allow(null, ''),
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
