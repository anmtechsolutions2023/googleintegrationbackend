// src/modules/poscustomer/poscustomer.schemas.js
// Joi validation schemas for POS Customer operations.

const Joi = require('joi');
const { GSTIN_PATTERN } = require('../../utils/gstStates');

// A business customer's GSTIN. Format-checked only — the portal is the
// authority on whether it is real — but a typo caught here is one that never
// reaches an invoice the accountant then cannot file.
const gstinField = Joi.string().trim().uppercase().pattern(GSTIN_PATTERN)
  .allow(null, '').optional()
  .messages({ 'string.pattern.base': 'GSTIN must be 15 characters in the GST format.' });
const { entityId, optionalEntityId } = require('../../utils/idSchema');

const createSchema = Joi.object({
  Name: Joi.string().required().max(100).allow(null).trim(),
  Phone: Joi.string().optional().max(20).allow(null, '').trim(),
  Email: Joi.string().optional().max(100).allow(null, '').trim(),
  Visits: Joi.number().integer().optional().default(0).allow(null),
  TotalSpent: Joi.number().optional().default(0).allow(null),
  LoyaltyPoints: Joi.number().integer().optional().default(0).allow(null),
  BranchDetailId: optionalEntityId,
  GSTIN: gstinField,
  LegalName: Joi.string().max(150).trim().allow(null, '').optional(),
  Active: Joi.boolean().optional().default(true),
});

const updateSchema = Joi.object({
  Name: Joi.string().optional().max(100).allow(null, '').trim(),
  Phone: Joi.string().optional().max(20).allow(null, '').trim(),
  Email: Joi.string().optional().max(100).allow(null, '').trim(),
  Visits: Joi.number().integer().optional().allow(null),
  TotalSpent: Joi.number().optional().allow(null),
  LoyaltyPoints: Joi.number().integer().optional().allow(null),
  BranchDetailId: optionalEntityId,
  GSTIN: gstinField,
  LegalName: Joi.string().max(150).trim().allow(null, '').optional(),
  Active: Joi.boolean().optional(),
}).min(1);

const paginationSchema = Joi.object({
  page: Joi.number().integer().min(1).optional().default(1),
  limit: Joi.number().integer().min(1).max(100).optional().default(10),
});

// A search needs something to search for. Bounded at both ends: one character
// would return the whole book, and there is no useful query longer than this.
const searchQuerySchema = Joi.object({
  q: Joi.string().min(2).max(50).required().trim(),
});

const uuidParamSchema = Joi.object({
  id: entityId.required(),
});

module.exports = {
  searchQuerySchema, createSchema, updateSchema, paginationSchema, uuidParamSchema };
