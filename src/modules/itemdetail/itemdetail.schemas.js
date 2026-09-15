// src/modules/itemdetail/itemdetail.schemas.js
const Joi = require('joi');
const { SUPPLY_TYPES } = require('../../config/constants');
const { entityId, optionalEntityId } = require('../../utils/idSchema');
const { taxBreakdownEcho } = require('../pricing/pricing.enrich');
const { joinedEchoes } = require('../../utils/joinedEchoes');
const { QUERIES } = require('../../config/constants');

const createSchema = Joi.object({
  // Every alias this module's SELECT joins in, accepted and dropped. An edit
  // form is seeded from a GET and sends the whole row back, so a joined column
  // would otherwise be rejected as an unknown key and refuse the whole save.
  // First in the literal, so the real rules below override any alias that is
  // also a genuine input.
  ...joinedEchoes(QUERIES.ITEM_DETAIL),
  Name: Joi.string().required().max(255).trim(),
  Code: Joi.string().optional().max(50).trim().allow(null, ''),
  Description: Joi.string().optional().max(1000).trim().allow(null, ''),
  CategoryId: optionalEntityId,
  UOMId: optionalEntityId,
  CostInfoId: optionalEntityId,
  // 50, not 100: itemdetail.SKU and .Barcode are VARCHAR(50). A Joi rule looser
  // than its column turns a clear 400 into a 500 from MySQL.
  SKU: Joi.string().optional().max(50).trim().allow(null, ''),
  Barcode: Joi.string().optional().max(50).trim().allow(null, ''),
  HSNCode: Joi.string().optional().max(50).trim().allow(null, ''),
  // GST 9(5). HSN codes goods, SAC codes services; an item carries whichever
  // its SupplyType calls for. Constrained here rather than by a database ENUM
  // so the vocabulary can grow without a schema rebuild.
  SupplyType: Joi.string().valid(...Object.values(SUPPLY_TYPES)).optional(),
  SACCode: Joi.string().optional().max(50).trim().allow(null, ''),
  Active: Joi.boolean().optional().default(true),
  TaxBreakdown: taxBreakdownEcho(),
});

const updateSchema = Joi.object({
  // Every alias this module's SELECT joins in, accepted and dropped. An edit
  // form is seeded from a GET and sends the whole row back, so a joined column
  // would otherwise be rejected as an unknown key and refuse the whole save.
  // First in the literal, so the real rules below override any alias that is
  // also a genuine input.
  ...joinedEchoes(QUERIES.ITEM_DETAIL),
  Name: Joi.string().optional().max(255).trim(),
  Code: Joi.string().optional().max(50).trim().allow(null, ''),
  Description: Joi.string().optional().max(1000).trim().allow(null, ''),
  CategoryId: optionalEntityId,
  UOMId: optionalEntityId,
  CostInfoId: optionalEntityId,
  // 50, not 100: itemdetail.SKU and .Barcode are VARCHAR(50). A Joi rule looser
  // than its column turns a clear 400 into a 500 from MySQL.
  SKU: Joi.string().optional().max(50).trim().allow(null, ''),
  Barcode: Joi.string().optional().max(50).trim().allow(null, ''),
  HSNCode: Joi.string().optional().max(50).trim().allow(null, ''),
  // GST 9(5). HSN codes goods, SAC codes services; an item carries whichever
  // its SupplyType calls for. Constrained here rather than by a database ENUM
  // so the vocabulary can grow without a schema rebuild.
  SupplyType: Joi.string().valid(...Object.values(SUPPLY_TYPES)).optional(),
  SACCode: Joi.string().optional().max(50).trim().allow(null, ''),
  Active: Joi.boolean().optional(),
  TaxBreakdown: taxBreakdownEcho(),
}).min(1);

const paginationSchema = Joi.object({
  page: Joi.number().integer().min(1).optional().default(1),
  limit: Joi.number().integer().min(1).max(100).optional().default(10),
  expand: Joi.boolean().optional().default(false),
});

const getByIdQuerySchema = Joi.object({
  expand: Joi.boolean().optional().default(false),
});

const uuidParamSchema = Joi.object({
  id: entityId.required(),
});

module.exports = {
  createSchema,
  updateSchema,
  paginationSchema,
  uuidParamSchema,
  getByIdQuerySchema,
};
