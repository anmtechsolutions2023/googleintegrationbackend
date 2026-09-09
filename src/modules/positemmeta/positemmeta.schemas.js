// src/modules/positemmeta/positemmeta.schemas.js
// Joi validation schemas for POS Item Meta operations.

const Joi = require('joi');
const { entityId } = require('../../utils/idSchema');
const { taxBreakdownEcho } = require('../pricing/pricing.enrich');
const { joinedEchoes } = require('../../utils/joinedEchoes');
const { QUERIES } = require('../../config/constants');

// Channels/Variants now come as ChannelIds/VariantIds arrays (synced to the
// join tables), price via CostInfoId, and food type via FoodTypeId (references
// the pos_food_type master). The legacy Channels/Prices/Variants JSON columns
// are kept optional for backward compatibility.
const uuidArray = Joi.array().items(entityId);

const jsonCol = Joi.alternatives(Joi.object(), Joi.array()).allow(null);

// The measurable nutrition fields, mirroring pos_item_nutrition. Every one is
// optional: a kitchen that has had one dish lab-tested should be able to record
// that dish without inventing figures for the other nine columns.
//
// Read-only columns are stripped rather than rejected — a GET returns the whole
// row (Id, audit fields), and an edit form populated from it echoes them back.
// Rejecting would make the natural round-trip fail for no reason.
//
// `null` for the whole object is meaningful and allowed: it CLEARS the row.
const nutritionSchema = Joi.object({
  ServingSizeG: Joi.number().min(0).allow(null).optional(),
  Calories: Joi.number().min(0).allow(null).optional(),
  ProteinG: Joi.number().min(0).allow(null).optional(),
  CarbohydrateG: Joi.number().min(0).allow(null).optional(),
  SugarG: Joi.number().min(0).allow(null).optional(),
  FatG: Joi.number().min(0).allow(null).optional(),
  SaturatedFatG: Joi.number().min(0).allow(null).optional(),
  FibreG: Joi.number().min(0).allow(null).optional(),
  SodiumMg: Joi.number().min(0).allow(null).optional(),
  Allergens: Joi.string().max(500).allow('', null).optional(),
  Id: Joi.any().optional().strip(),
  ItemMetaId: Joi.any().optional().strip(),
  TenantId: Joi.any().optional().strip(),
  Active: Joi.any().optional().strip(),
  CreatedOn: Joi.any().optional().strip(),
  CreatedBy: Joi.any().optional().strip(),
  UpdatedOn: Joi.any().optional().strip(),
  UpdatedBy: Joi.any().optional().strip(),
}).allow(null);

const createSchema = Joi.object({
  // Every alias this module's SELECT joins in, accepted and dropped. An edit
  // form is seeded from a GET and sends the whole row back, so a joined column
  // would otherwise be rejected as an unknown key and refuse the whole save.
  // First in the literal, so the real rules below override any alias that is
  // also a genuine input.
  ...joinedEchoes(QUERIES.POS_ITEM_META),
  ItemDetailId: entityId.required(),
  FoodTypeId: entityId.required(),
  CostInfoId: entityId.optional().allow(null),
  ChannelIds: uuidArray.optional(),
  VariantIds: uuidArray.optional(),
  AddonGroupIds: uuidArray.optional(),
  TagIds: uuidArray.optional(),
  // What the dish IS, beyond its price. ServesCount counts people; PortionSize
  // is the measure ("350 ml") — they answer different questions.
  ServesCount: Joi.number().integer().min(0).max(255).allow(null).optional(),
  PortionSize: Joi.string().max(50).allow('', null).optional(),
  // Orthogonal to FoodTypeId: a dish is Non-Veg AND Chicken.
  MeatTypeId: entityId.allow(null).optional(),
  // This dish's own prep time. The order-level KPT sent to a portal is derived
  // from the slowest line, so it is not stored twice.
  PrepTimeMinutes: Joi.number().integer().min(0).allow(null).optional(),
  Nutrition: nutritionSchema.optional(),
  Channels: jsonCol.optional(),
  Prices: jsonCol.optional(),
  Variants: jsonCol.optional(),
  BranchDetailId: entityId.required(),
  Active: Joi.boolean().optional().default(true),
  // TaxBreakdown is not a SELECT alias — pricing.enrich computes it after the
  // read — so joinedEchoes cannot see it and it stays listed by hand.
  TaxBreakdown: taxBreakdownEcho(),
});

const updateSchema = Joi.object({
  // Every alias this module's SELECT joins in, accepted and dropped. An edit
  // form is seeded from a GET and sends the whole row back, so a joined column
  // would otherwise be rejected as an unknown key and refuse the whole save.
  // First in the literal, so the real rules below override any alias that is
  // also a genuine input.
  ...joinedEchoes(QUERIES.POS_ITEM_META),
  ItemDetailId: entityId.optional(),
  FoodTypeId: entityId.optional(),
  CostInfoId: entityId.optional().allow(null),
  ChannelIds: uuidArray.optional(),
  VariantIds: uuidArray.optional(),
  AddonGroupIds: uuidArray.optional(),
  TagIds: uuidArray.optional(),
  // What the dish IS, beyond its price. ServesCount counts people; PortionSize
  // is the measure ("350 ml") — they answer different questions.
  ServesCount: Joi.number().integer().min(0).max(255).allow(null).optional(),
  PortionSize: Joi.string().max(50).allow('', null).optional(),
  // Orthogonal to FoodTypeId: a dish is Non-Veg AND Chicken.
  MeatTypeId: entityId.allow(null).optional(),
  // This dish's own prep time. The order-level KPT sent to a portal is derived
  // from the slowest line, so it is not stored twice.
  PrepTimeMinutes: Joi.number().integer().min(0).allow(null).optional(),
  Nutrition: nutritionSchema.optional(),
  Channels: jsonCol.optional(),
  Prices: jsonCol.optional(),
  Variants: jsonCol.optional(),
  BranchDetailId: entityId.optional(),
  Active: Joi.boolean().optional(),
  // TaxBreakdown is not a SELECT alias — pricing.enrich computes it after the
  // read — so joinedEchoes cannot see it and it stays listed by hand.
  TaxBreakdown: taxBreakdownEcho(),
}).min(1);

const paginationSchema = Joi.object({
  page: Joi.number().integer().min(1).optional().default(1),
  limit: Joi.number().integer().min(1).max(100).optional().default(10),
});

const uuidParamSchema = Joi.object({
  id: entityId.required(),
});

module.exports = { createSchema, updateSchema, paginationSchema, uuidParamSchema };
