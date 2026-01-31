// src/modules/category/category.schemas.js
// Joi validation schemas for Category operations
// Centralized validation rules for better maintainability

const Joi = require('joi');

// Schema for creating a new category
const createCategorySchema = Joi.object({
  Name: Joi.string().required().max(100).trim(),
  Active: Joi.boolean().optional().default(true),
});

// Schema for updating an existing category
const updateCategorySchema = Joi.object({
  Name: Joi.string().optional().max(100).trim(),
  Active: Joi.boolean().optional(),
}).min(1); // At least one field must be provided

// Schema for pagination query parameters
const paginationSchema = Joi.object({
  page: Joi.number().integer().min(1).optional().default(1),
  limit: Joi.number().integer().min(1).max(100).optional().default(10),
});

// Schema for UUID parameter validation
const uuidParamSchema = Joi.object({
  id: Joi.string().uuid().required(),
});

module.exports = {
  createCategorySchema,
  updateCategorySchema,
  paginationSchema,
  uuidParamSchema,
};
