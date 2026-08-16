// src/modules/asset/asset.schemas.js
// Joi validation schemas for the asset register.

const Joi = require('joi');
const { ASSET_STATUS } = require('../../config/constants');

const STATUSES = Object.values(ASSET_STATUS);

const createSchema = Joi.object({
  Name: Joi.string().max(150).required().trim(),
  AssetCategoryId: Joi.string().uuid().required(),
  // Required: an asset that belongs to no branch answers none of the questions
  // the register exists to answer.
  BranchDetailId: Joi.string().uuid().required(),
  SerialNo: Joi.string().max(100).optional().allow(null, '').trim(),
  PurchaseDate: Joi.date().optional().allow(null),
  PurchaseCost: Joi.number().min(0).optional().default(0),
  SupplierContactDetailId: Joi.string().uuid().optional().allow(null),
  Status: Joi.string().valid(...STATUSES).optional().default(ASSET_STATUS.IN_USE),
  Notes: Joi.string().max(500).optional().allow(null, '').trim(),
  Active: Joi.boolean().optional().default(true),
});

const updateSchema = Joi.object({
  Name: Joi.string().max(150).optional().trim(),
  AssetCategoryId: Joi.string().uuid().optional(),
  BranchDetailId: Joi.string().uuid().optional(),
  SerialNo: Joi.string().max(100).optional().allow(null, '').trim(),
  PurchaseDate: Joi.date().optional().allow(null),
  PurchaseCost: Joi.number().min(0).optional(),
  SupplierContactDetailId: Joi.string().uuid().optional().allow(null),
  Status: Joi.string().valid(...STATUSES).optional(),
  Notes: Joi.string().max(500).optional().allow(null, '').trim(),
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
