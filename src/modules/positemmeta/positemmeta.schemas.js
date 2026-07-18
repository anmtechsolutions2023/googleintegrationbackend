// src/modules/positemmeta/positemmeta.schemas.js
// Joi validation schemas for POS Item Meta operations.

const Joi = require('joi');

// Channels/Variants now come as ChannelIds/VariantIds arrays (synced to the
// join tables) and price via CostInfoId. The legacy Channels/Prices/Variants/
// Addons JSON columns are kept optional for backward compatibility.
const uuidArray = Joi.array().items(Joi.string().uuid());

const jsonCol = Joi.alternatives(Joi.object(), Joi.array()).allow(null);

const createSchema = Joi.object({
  ItemDetailId: Joi.string().uuid().required(),
  FoodType: Joi.string().max(20).trim().required(),
  CostInfoId: Joi.string().uuid().optional().allow(null),
  ChannelIds: uuidArray.optional(),
  VariantIds: uuidArray.optional(),
  Channels: jsonCol.optional(),
  Prices: jsonCol.optional(),
  Variants: jsonCol.optional(),
  Addons: jsonCol.optional(),
  BranchDetailId: Joi.string().uuid().required(),
  Active: Joi.boolean().optional().default(true),
  // Read-only fields the client may echo back on edit; ignored server-side.
  CostInfoAmount: Joi.any().optional().strip(),
});

const updateSchema = Joi.object({
  ItemDetailId: Joi.string().uuid().optional(),
  FoodType: Joi.string().max(20).trim().optional(),
  CostInfoId: Joi.string().uuid().optional().allow(null),
  ChannelIds: uuidArray.optional(),
  VariantIds: uuidArray.optional(),
  Channels: jsonCol.optional(),
  Prices: jsonCol.optional(),
  Variants: jsonCol.optional(),
  Addons: jsonCol.optional(),
  BranchDetailId: Joi.string().uuid().optional(),
  Active: Joi.boolean().optional(),
  // Read-only fields the client may echo back on edit; ignored server-side.
  CostInfoAmount: Joi.any().optional().strip(),
}).min(1);

const paginationSchema = Joi.object({
  page: Joi.number().integer().min(1).optional().default(1),
  limit: Joi.number().integer().min(1).max(100).optional().default(10),
});

const uuidParamSchema = Joi.object({
  id: Joi.string().uuid().required(),
});

module.exports = { createSchema, updateSchema, paginationSchema, uuidParamSchema };
