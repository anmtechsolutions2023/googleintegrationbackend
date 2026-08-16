// src/modules/posonlineorder/posonlineorder.schemas.js
// Joi validation schemas for POS Online Order operations.

const Joi = require('joi');
const { POS_ONLINE_ORDER_STATUSES } = require('../../config/constants');

// Canonical lowercase enum, normalized on write. Status was free text, so
// 'Waiting' and 'waiting' could both be stored and every reader had to guess.
const statusField = Joi.string().lowercase().valid(...POS_ONLINE_ORDER_STATUSES);

const createSchema = Joi.object({
  Platform: Joi.string().required().max(50).allow(null).trim(),
  ExternalRef: Joi.string().optional().max(100).allow(null, '').trim(),
  Status: statusField.optional().allow(null, '').default('new'),
  Payload: Joi.alternatives(Joi.object(), Joi.array()).optional().allow(null),
  BranchDetailId: Joi.string().uuid().optional().allow(null),
  Active: Joi.boolean().optional().default(true),
});

const updateSchema = Joi.object({
  Platform: Joi.string().optional().max(50).allow(null, '').trim(),
  ExternalRef: Joi.string().optional().max(100).allow(null, '').trim(),
  Status: statusField.optional().allow(null, ''),
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
