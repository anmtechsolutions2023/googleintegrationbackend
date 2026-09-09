// src/modules/posmenutag/posmenutag.schemas.js
// Joi validation schemas for POS Menu Tag master operations.

const Joi = require('joi');
const { entityId } = require('../../utils/idSchema');
const { POS_MENU_TAG_TYPES } = require('../../config/constants');

const TAG_TYPES = Object.values(POS_MENU_TAG_TYPES);

const createSchema = Joi.object({
  Name: Joi.string().max(100).trim().required(),
  Code: Joi.string().max(50).trim().required(),
  // Constrained here rather than by a database ENUM: the vocabulary can grow
  // without a schema rebuild, and this project rebuilds rather than migrates.
  TagType: Joi.string().valid(...TAG_TYPES).optional().default(POS_MENU_TAG_TYPES.CATEGORY),
  SortOrder: Joi.number().integer().optional().default(0),
  Active: Joi.boolean().optional().default(true),
});

const updateSchema = Joi.object({
  Name: Joi.string().max(100).trim().optional(),
  Code: Joi.string().max(50).trim().optional(),
  TagType: Joi.string().valid(...TAG_TYPES).optional(),
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

const tagTypeParamSchema = Joi.object({
  tagType: Joi.string().valid(...TAG_TYPES).required(),
});

module.exports = {
  createSchema,
  updateSchema,
  paginationSchema,
  uuidParamSchema,
  tagTypeParamSchema,
  TAG_TYPES,
};
