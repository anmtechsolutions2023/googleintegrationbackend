// src/modules/asset/asset.schemas.js
// Joi validation schemas for the asset register.

const Joi = require('joi');
const { entityId } = require('../../utils/idSchema');
const { ASSET_STATUS } = require('../../config/constants');
const { joinedEchoes } = require('../../utils/joinedEchoes');
const { QUERIES } = require('../../config/constants');

const STATUSES = Object.values(ASSET_STATUS);

const createSchema = Joi.object({
  // Every alias this module's SELECT joins in, accepted and dropped. An edit
  // form is seeded from a GET and sends the whole row back, so a joined column
  // would otherwise be rejected as an unknown key and refuse the whole save.
  // First in the literal, so the real rules below override any alias that is
  // also a genuine input.
  ...joinedEchoes(QUERIES.ASSET),
  Name: Joi.string().max(150).required().trim(),
  AssetCategoryId: entityId.required(),
  // Required: an asset that belongs to no branch answers none of the questions
  // the register exists to answer.
  BranchDetailId: entityId.required(),
  SerialNo: Joi.string().max(100).optional().allow(null, '').trim(),
  PurchaseDate: Joi.date().optional().allow(null),
  PurchaseCost: Joi.number().min(0).optional().default(0),
  SupplierContactDetailId: entityId.optional().allow(null),
  Status: Joi.string().valid(...STATUSES).optional().default(ASSET_STATUS.IN_USE),
  Notes: Joi.string().max(500).optional().allow(null, '').trim(),
  Active: Joi.boolean().optional().default(true),
});

const updateSchema = Joi.object({
  // Every alias this module's SELECT joins in, accepted and dropped. An edit
  // form is seeded from a GET and sends the whole row back, so a joined column
  // would otherwise be rejected as an unknown key and refuse the whole save.
  // First in the literal, so the real rules below override any alias that is
  // also a genuine input.
  ...joinedEchoes(QUERIES.ASSET),
  Name: Joi.string().max(150).optional().trim(),
  AssetCategoryId: entityId.optional(),
  BranchDetailId: entityId.optional(),
  SerialNo: Joi.string().max(100).optional().allow(null, '').trim(),
  PurchaseDate: Joi.date().optional().allow(null),
  PurchaseCost: Joi.number().min(0).optional(),
  SupplierContactDetailId: entityId.optional().allow(null),
  Status: Joi.string().valid(...STATUSES).optional(),
  Notes: Joi.string().max(500).optional().allow(null, '').trim(),
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
