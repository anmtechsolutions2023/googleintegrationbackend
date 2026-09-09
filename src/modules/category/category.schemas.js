// src/modules/category/category.schemas.js
// Joi validation schemas for Category operations
// Centralized validation rules for better maintainability

const Joi = require('joi');
const { entityId } = require('../../utils/idSchema');
const { joinedEchoes } = require('../../utils/joinedEchoes');
const { QUERIES } = require('../../config/constants');

// Name is max 50, NOT 100: categorydetail.Name is VARCHAR(50). The looser rule
// let a 51-character name past validation and into MySQL, where it fails as a
// 500 rather than a 400 that names the field. The database is the source of
// truth — the app layer moves to match it, never the other way round.
const NAME_MAX = 50;

// Schema for creating a new category
const createCategorySchema = Joi.object({
  // Every alias this module's SELECT joins in, accepted and dropped. An edit
  // form is seeded from a GET and sends the whole row back, so a joined column
  // would otherwise be rejected as an unknown key and refuse the whole save.
  // First in the literal, so the real rules below override any alias that is
  // also a genuine input.
  ...joinedEchoes(QUERIES.CATEGORY),
  Name: Joi.string().required().max(NAME_MAX).trim(),
  // Null or absent = a top-level category. Depth is enforced in the service,
  // which needs a lookup Joi cannot do.
  ParentId: entityId.allow(null).optional(),
  SortOrder: Joi.number().integer().optional().default(0),
  Active: Joi.boolean().optional().default(true),
});

// Schema for updating an existing category
const updateCategorySchema = Joi.object({
  // Every alias this module's SELECT joins in, accepted and dropped. An edit
  // form is seeded from a GET and sends the whole row back, so a joined column
  // would otherwise be rejected as an unknown key and refuse the whole save.
  // First in the literal, so the real rules below override any alias that is
  // also a genuine input.
  ...joinedEchoes(QUERIES.CATEGORY),
  Name: Joi.string().optional().max(NAME_MAX).trim(),
  // Explicit null promotes a sub-category back to top level, which is why null
  // is allowed rather than stripped — omitting the key means "leave it alone",
  // and the two must stay distinguishable.
  ParentId: entityId.allow(null).optional(),
  SortOrder: Joi.number().integer().optional(),
  Active: Joi.boolean().optional(),
}).min(1); // At least one field must be provided

// Schema for pagination query parameters
const paginationSchema = Joi.object({
  page: Joi.number().integer().min(1).optional().default(1),
  limit: Joi.number().integer().min(1).max(100).optional().default(10),
});

// Schema for UUID parameter validation
const uuidParamSchema = Joi.object({
  id: entityId.required(),
});

module.exports = {
  createCategorySchema,
  updateCategorySchema,
  paginationSchema,
  uuidParamSchema,
};
