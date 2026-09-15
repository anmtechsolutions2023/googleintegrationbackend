// src/modules/postable/postable.schemas.js
// Joi validation schemas for POS Table operations.

const Joi = require('joi');
const { entityId, optionalEntityId } = require('../../utils/idSchema');
const { POS_TABLE_STATUSES } = require('../../config/constants');

// Status is a fixed enum (free / occupied / reserved), matching the DDL default.
// It drives the occupancy-view color coding on the frontend, so only these values
// are valid. `.lowercase()` normalizes on write so a client still sending the old
// title-case spelling converges instead of being rejected.
const createSchema = Joi.object({
  Name: Joi.string().required().max(50).allow(null).trim(),
  FloorId: optionalEntityId,
  Capacity: Joi.number().integer().optional().allow(null),
  Status: Joi.string().lowercase().valid(...POS_TABLE_STATUSES).optional().allow(null, '').default('free'),
  CurrentOrderId: optionalEntityId,
  BranchDetailId: optionalEntityId,
  Active: Joi.boolean().optional().default(true),
});

const updateSchema = Joi.object({
  Name: Joi.string().optional().max(50).allow(null, '').trim(),
  FloorId: optionalEntityId,
  Capacity: Joi.number().integer().optional().allow(null),
  Status: Joi.string().lowercase().valid(...POS_TABLE_STATUSES).optional().allow(null, ''),
  CurrentOrderId: optionalEntityId,
  BranchDetailId: optionalEntityId,
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
