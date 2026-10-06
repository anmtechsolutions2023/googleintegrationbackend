// src/modules/menu/menu.schemas.js
const Joi = require('joi');
const { entityId } = require('../../utils/idSchema');

const text = (max) => Joi.string().trim().max(max);
const optText = (max) => text(max).allow('', null).optional();
const money = Joi.number().min(0).max(9999999);

const nutritionSchema = Joi.object({
  ServingSizeG: money.allow(null),
  Calories: money.allow(null),
  ProteinG: money.allow(null),
  CarbohydrateG: money.allow(null),
  SugarG: money.allow(null),
  FatG: money.allow(null),
  SaturatedFatG: money.allow(null),
  FibreG: money.allow(null),
  SodiumMg: money.allow(null),
  Allergens: optText(500),
}).unknown(false);

/**
 * A whole dish, as the editor sends it. Masters by NAME (created when new);
 * branches, channels and portals by id (never created from here).
 */
const dishSchema = Joi.object({
  code: optText(50),
  name: text(255).required(),
  // "Parent › Child" is allowed; each level is a category name of up to 50.
  category: text(120).required(),
  description: optText(1000),
  diet: text(100).required(),
  meatType: optText(100),
  unit: text(50).required(),
  sku: optText(100),
  barcode: optText(100),
  hsn: optText(50),
  sac: optText(50),
  price: money.required(),
  // Blank = the Exempt (0%) group.
  taxGroup: optText(50),
  taxComponents: Joi.array().max(6).items(Joi.object({
    name: text(30).required(),
    value: Joi.alternatives(Joi.number().min(0).max(100), text(10)).required(),
  })).optional(),
  taxIncluded: Joi.boolean().default(false),
  branches: Joi.array().max(200).items(Joi.object({
    branchId: entityId.required(),
    channelIds: Joi.array().max(50).items(entityId).default([]),
    price: money.allow(null).default(null),
  })).required(),
  variants: Joi.array().max(20).items(Joi.object({
    name: text(100).required(),
    surcharge: money.required(),
  })).default([]),
  addonGroups: Joi.array().max(20).items(text(100)).default([]),
  tags: Joi.array().max(30).items(text(100)).default([]),
  serves: Joi.number().integer().min(0).max(255).allow(null).optional(),
  portion: optText(50),
  prepMin: Joi.number().integer().min(0).max(600).allow(null).optional(),
  maxPerOrder: Joi.number().integer().min(1).max(999).allow(null).optional(),
  stockTracked: Joi.boolean().default(false),
  nutrition: nutritionSchema.allow(null).optional(),
  portals: Joi.array().max(20).items(Joi.object({
    portalId: entityId.required(),
    listed: Joi.boolean().required(),
    price: money.allow(null).default(null),
    name: optText(255),
  })).default([]),
  status: Joi.string().valid('Active', 'Hidden').default('Active'),
  // Read-only fields the editor may echo back.
  itemId: Joi.any().strip(),
  hasPhoto: Joi.any().strip(),
  photoVersion: Joi.any().strip(),
});

// A parsed CSV row: header → cell text. Kept loose on purpose — the importer
// reports a bad cell against its row instead of refusing the whole file.
const csvRow = Joi.object().pattern(Joi.string().max(80), Joi.alternatives(Joi.string().allow('').max(2000), Joi.number(), Joi.allow(null)));

const importSchema = Joi.object({
  menu: Joi.array().max(3000).items(csvRow).default([]),
  addons: Joi.array().max(3000).items(csvRow).default([]),
  hours: Joi.array().max(1000).items(csvRow).default([]),
});

const pricesSchema = Joi.object({
  changes: Joi.array().min(1).max(5000).items(Joi.object({
    itemId: entityId.required(),
    branchId: entityId.optional(),
    portalId: entityId.optional(),
    price: money.allow(null).optional(),
    listed: Joi.boolean().optional(),
  }).oxor('branchId', 'portalId')).required(),
});

const bulkSchema = Joi.object({
  itemIds: Joi.array().min(1).max(1000).items(entityId).required(),
  action: Joi.string().valid('hide', 'show', 'addTag', 'removeTag', 'list', 'unlist').required(),
  value: text(100).when('action', { is: Joi.valid('addTag', 'removeTag'), then: Joi.required() }),
  portalId: entityId.when('action', { is: Joi.valid('list', 'unlist'), then: Joi.required() }),
});

const photoSchema = Joi.object({
  // A data URI; the server re-measures the bytes (512KB cap).
  dataUri: Joi.string().max(1024 * 1024).required(),
  // The list-size copy the browser made (≤480px, ≤96KB). Optional: without it
  // lists fall back to the photo itself.
  thumbDataUri: Joi.string().max(160 * 1024).allow(null).optional(),
});

// An <img> asking for a photo. `v` only makes the URL change when the photo
// does; the server never compares it.
const photoImageQuery = Joi.object({
  size: Joi.string().valid('thumb', 'full').default('thumb'),
  v: Joi.string().max(20).pattern(/^[0-9]+$/).optional(),
});

const itemIdParam = Joi.object({ itemId: entityId.required() });

// Clearing the menu. The phrase is checked by the service on apply only.
const clearSchema = Joi.object({
  mode: Joi.string().valid('hide', 'empty').required(),
  removeUnused: Joi.boolean().default(false),
  confirm: Joi.string().trim().max(40).allow('').optional(),
});

module.exports = { dishSchema, importSchema, pricesSchema, bulkSchema, photoSchema, photoImageQuery, itemIdParam, clearSchema };
