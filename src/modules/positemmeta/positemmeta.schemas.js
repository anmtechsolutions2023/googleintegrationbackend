// src/modules/positemmeta/positemmeta.schemas.js
// Joi validation schemas for POS Item Meta operations.

const Joi = require('joi');
const { entityId, optionalEntityId } = require('../../utils/idSchema');
const { taxBreakdownEcho } = require('../pricing/pricing.enrich');
const { joinedEchoes } = require('../../utils/joinedEchoes');
const { optionalNumber, optionalObject } = require('../../utils/optionalFields');
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
// Every figure here is optional, and an emptied <input type="number"> posts ''.
// optionalNumber accepts that and stores NULL — see utils/optionalFields.
const nutritionFigure = optionalNumber({ min: 0 });

const nutritionFields = Joi.object({
  ServingSizeG: nutritionFigure,
  Calories: nutritionFigure,
  ProteinG: nutritionFigure,
  CarbohydrateG: nutritionFigure,
  SugarG: nutritionFigure,
  FatG: nutritionFigure,
  SaturatedFatG: nutritionFigure,
  FibreG: nutritionFigure,
  SodiumMg: nutritionFigure,
  Allergens: Joi.string().max(500).allow('', null).optional(),
  Id: Joi.any().optional().strip(),
  ItemMetaId: Joi.any().optional().strip(),
  TenantId: Joi.any().optional().strip(),
  Active: Joi.any().optional().strip(),
  CreatedOn: Joi.any().optional().strip(),
  CreatedBy: Joi.any().optional().strip(),
  UpdatedOn: Joi.any().optional().strip(),
  UpdatedBy: Joi.any().optional().strip(),
});

// The BLOCK is optional too, not only the figures in it. A form that renders
// an empty nutrition panel posts '' for the whole thing; null is what
// syncNutrition reads as "remove the nutrition row", which is what clearing
// the panel means. Omitting it entirely still means "leave it alone".
const nutritionSchema = optionalObject(nutritionFields, 'a set of nutrition figures');

const createSchema = Joi.object({
  // Every alias this module's SELECT joins in, accepted and dropped. An edit
  // form is seeded from a GET and sends the whole row back, so a joined column
  // would otherwise be rejected as an unknown key and refuse the whole save.
  // First in the literal, so the real rules below override any alias that is
  // also a genuine input.
  ...joinedEchoes(QUERIES.POS_ITEM_META),
  ItemDetailId: entityId.required(),
  FoodTypeId: entityId.required(),
  CostInfoId: optionalEntityId,
  ChannelIds: uuidArray.optional(),
  VariantIds: uuidArray.optional(),
  AddonGroupIds: uuidArray.optional(),
  TagIds: uuidArray.optional(),
  // What the dish IS, beyond its price. ServesCount counts people; PortionSize
  // is the measure ("350 ml") — they answer different questions.
  ServesCount: optionalNumber({ min: 0, max: 255, integer: true }),
  PortionSize: Joi.string().max(50).allow('', null).optional(),
  // Orthogonal to FoodTypeId: a dish is Non-Veg AND Chicken.
  MeatTypeId: optionalEntityId,
  // This dish's own prep time. The order-level KPT sent to a portal is derived
  // from the slowest line, so it is not stored twice.
  PrepTimeMinutes: optionalNumber({ min: 0, integer: true }),
  Nutrition: nutritionSchema.optional(),
  Channels: jsonCol.optional(),
  Prices: jsonCol.optional(),
  Variants: jsonCol.optional(),
  BranchDetailId: entityId.required(),
  Active: Joi.boolean().optional().default(true),
  // Computed AFTER the query, by attachAvailability — so joinedEchoes, which
  // derives its tolerance from the SELECT, cannot see them. Anything a read
  // returns, a write has to accept back: an edit form is seeded from a GET and
  // posts the whole row, and a read-only field it never touched must not be
  // what refuses the save.
  CategoryAvailableNow: Joi.any().optional().strip(),
  CategoryOpensAt: Joi.any().optional().strip(),
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
  CostInfoId: optionalEntityId,
  ChannelIds: uuidArray.optional(),
  VariantIds: uuidArray.optional(),
  AddonGroupIds: uuidArray.optional(),
  TagIds: uuidArray.optional(),
  // What the dish IS, beyond its price. ServesCount counts people; PortionSize
  // is the measure ("350 ml") — they answer different questions.
  ServesCount: optionalNumber({ min: 0, max: 255, integer: true }),
  PortionSize: Joi.string().max(50).allow('', null).optional(),
  // Orthogonal to FoodTypeId: a dish is Non-Veg AND Chicken.
  MeatTypeId: optionalEntityId,
  // This dish's own prep time. The order-level KPT sent to a portal is derived
  // from the slowest line, so it is not stored twice.
  PrepTimeMinutes: optionalNumber({ min: 0, integer: true }),
  Nutrition: nutritionSchema.optional(),
  Channels: jsonCol.optional(),
  Prices: jsonCol.optional(),
  Variants: jsonCol.optional(),
  BranchDetailId: entityId.optional(),
  Active: Joi.boolean().optional(),
  // Computed AFTER the query, by attachAvailability — so joinedEchoes, which
  // derives its tolerance from the SELECT, cannot see them. Anything a read
  // returns, a write has to accept back: an edit form is seeded from a GET and
  // posts the whole row, and a read-only field it never touched must not be
  // what refuses the save.
  CategoryAvailableNow: Joi.any().optional().strip(),
  CategoryOpensAt: Joi.any().optional().strip(),
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

// ── Bulk update ──────────────────────────────────────────────────────────────
// One change for many rows. A link field says HOW: add these to every dish,
// remove them from every dish, or replace each dish's own set with these.
const listChange = Joi.object({
  mode: Joi.string().valid('add', 'remove', 'replace').required(),
  ids: uuidArray.max(200).unique().required(),
});

const bulkUpdateSchema = Joi.object({
  ids: Joi.array().items(entityId).min(1).max(500).unique().required(),
  changes: Joi.object({
    Active: Joi.boolean(),
    // Required on a dish, so a bulk change can set it but never clear it.
    FoodTypeId: entityId,
    // Optional on a dish: '' or null clears it for every selected row.
    MeatTypeId: optionalEntityId,
    PrepTimeMinutes: optionalNumber({ min: 0, integer: true }),
    ServesCount: optionalNumber({ min: 0, max: 255, integer: true }),
    ChannelIds: listChange,
    VariantIds: listChange,
    AddonGroupIds: listChange,
    TagIds: listChange,
  }).min(1).required(),
});

module.exports = { createSchema, updateSchema, paginationSchema, uuidParamSchema, bulkUpdateSchema };
