// src/modules/poskot/poskot.schemas.js
// Joi validation schemas for POS KOT operations.

const Joi = require('joi');
const { POS_KOT_STATUSES } = require('../../config/constants');

// Status was previously a free-text VARCHAR(20) with no validation, which let
// 'Ready', 'ready' and 'Delivered' all coexist and made every reader disagree.
// It is now the canonical lowercase enum, normalized on write.
const statusField = Joi.string().lowercase().valid(...POS_KOT_STATUSES);

// KotNo is issued server-side from the POS_KOT numbering series when omitted, so
// the client no longer has to invent one (it used to send an epoch timestamp).
const createSchema = Joi.object({
  KotNo: Joi.string().optional().max(50).allow(null, '').trim(),
  OrderId: Joi.string().uuid().optional().allow(null),
  TableId: Joi.string().uuid().optional().allow(null),
  Items: Joi.alternatives(Joi.object(), Joi.array()).optional().allow(null),
  Status: statusField.optional().allow(null, '').default('pending'),
  FiredAt: Joi.date().optional().allow(null),
  BranchDetailId: Joi.string().uuid().optional().allow(null),
  Active: Joi.boolean().optional().default(true),
});

const updateSchema = Joi.object({
  KotNo: Joi.string().optional().max(50).allow(null, '').trim(),
  OrderId: Joi.string().uuid().optional().allow(null),
  TableId: Joi.string().uuid().optional().allow(null),
  Items: Joi.alternatives(Joi.object(), Joi.array()).optional().allow(null),
  Status: statusField.optional().allow(null, ''),
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
