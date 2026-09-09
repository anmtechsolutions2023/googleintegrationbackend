// src/modules/posaddon/posaddon.schemas.js
// Joi validation schemas for POS Add-on master operations.

const Joi = require('joi');
const { entityId } = require('../../utils/idSchema');
const { joinedEchoes } = require('../../utils/joinedEchoes');
const { QUERIES } = require('../../config/constants');

const createSchema = Joi.object({
  // Every alias this module's SELECT joins in, accepted and dropped. An edit
  // form is seeded from a GET and sends the whole row back, so a joined column
  // would otherwise be rejected as an unknown key and refuse the whole save.
  // First in the literal, so the real rules below override any alias that is
  // also a genuine input.
  ...joinedEchoes(QUERIES.POS_ADDON),
  AddonGroupId: entityId.required(),
  Name: Joi.string().max(100).trim().required(),
  Code: Joi.string().max(50).trim().required(),
  // DECIMAL(18,4) in the column. Zero is valid and common — "no onions" costs
  // nothing but is still a choice the kitchen has to be told about.
  Price: Joi.number().min(0).precision(4).optional().default(0),
  // Dietary tag on the add-on itself; optional because a vegetarian kitchen
  // has nothing to distinguish.
  FoodTypeId: entityId.allow(null).optional(),
  SortOrder: Joi.number().integer().optional().default(0),
  Active: Joi.boolean().optional().default(true),
});

const updateSchema = Joi.object({
  // Every alias this module's SELECT joins in, accepted and dropped. An edit
  // form is seeded from a GET and sends the whole row back, so a joined column
  // would otherwise be rejected as an unknown key and refuse the whole save.
  // First in the literal, so the real rules below override any alias that is
  // also a genuine input.
  ...joinedEchoes(QUERIES.POS_ADDON),
  AddonGroupId: entityId.optional(),
  Name: Joi.string().max(100).trim().optional(),
  Code: Joi.string().max(50).trim().optional(),
  Price: Joi.number().min(0).precision(4).optional(),
  FoodTypeId: entityId.allow(null).optional(),
  SortOrder: Joi.number().integer().optional(),
  Active: Joi.boolean().optional(),
}).min(1);

const paginationSchema = Joi.object({
  page: Joi.number().integer().min(1).optional().default(1),
  limit: Joi.number().integer().min(1).max(100).optional().default(10),
});

const uuidParamSchema = Joi.object({
  id: entityId.required(),
});

const groupParamSchema = Joi.object({
  addonGroupId: entityId.required(),
});

module.exports = {
  createSchema,
  updateSchema,
  paginationSchema,
  uuidParamSchema,
  groupParamSchema,
};
