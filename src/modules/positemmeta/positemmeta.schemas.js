// src/modules/positemmeta/positemmeta.schemas.js
// Joi validation schemas for POS Item Meta operations.

const Joi = require('joi');
const { taxBreakdownEcho } = require('../pricing/pricing.enrich');

// Channels/Variants now come as ChannelIds/VariantIds arrays (synced to the
// join tables), price via CostInfoId, and food type via FoodTypeId (references
// the pos_food_type master). The legacy Channels/Prices/Variants JSON columns
// are kept optional for backward compatibility.
const uuidArray = Joi.array().items(Joi.string().uuid());

const jsonCol = Joi.alternatives(Joi.object(), Joi.array()).allow(null);

const createSchema = Joi.object({
  ItemDetailId: Joi.string().uuid().required(),
  FoodTypeId: Joi.string().uuid().required(),
  CostInfoId: Joi.string().uuid().optional().allow(null),
  ChannelIds: uuidArray.optional(),
  VariantIds: uuidArray.optional(),
  Channels: jsonCol.optional(),
  Prices: jsonCol.optional(),
  Variants: jsonCol.optional(),
  BranchDetailId: Joi.string().uuid().required(),
  Active: Joi.boolean().optional().default(true),
  // Read-only fields the client may echo back on edit; ignored server-side.
  // These come from the SELECT joins (costinfo, pos_food_type), so an edit form
  // populated from a GET response naturally carries them back.
  CostInfoAmount: Joi.any().optional().strip(),
  FoodTypeName: Joi.any().optional().strip(),
  FoodTypeIsVeg: Joi.any().optional().strip(),
  // Computed on every read by pricing.enrich, so it rides back on every edit.
  TaxBreakdown: taxBreakdownEcho(),
});

const updateSchema = Joi.object({
  ItemDetailId: Joi.string().uuid().optional(),
  FoodTypeId: Joi.string().uuid().optional(),
  CostInfoId: Joi.string().uuid().optional().allow(null),
  ChannelIds: uuidArray.optional(),
  VariantIds: uuidArray.optional(),
  Channels: jsonCol.optional(),
  Prices: jsonCol.optional(),
  Variants: jsonCol.optional(),
  BranchDetailId: Joi.string().uuid().optional(),
  Active: Joi.boolean().optional(),
  // Read-only fields the client may echo back on edit; ignored server-side.
  // These come from the SELECT joins (costinfo, pos_food_type), so an edit form
  // populated from a GET response naturally carries them back.
  CostInfoAmount: Joi.any().optional().strip(),
  FoodTypeName: Joi.any().optional().strip(),
  FoodTypeIsVeg: Joi.any().optional().strip(),
  // Computed on every read by pricing.enrich, so it rides back on every edit.
  TaxBreakdown: taxBreakdownEcho(),
}).min(1);

const paginationSchema = Joi.object({
  page: Joi.number().integer().min(1).optional().default(1),
  limit: Joi.number().integer().min(1).max(100).optional().default(10),
});

const uuidParamSchema = Joi.object({
  id: Joi.string().uuid().required(),
});

module.exports = { createSchema, updateSchema, paginationSchema, uuidParamSchema };
