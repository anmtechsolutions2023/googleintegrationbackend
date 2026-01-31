// src/modules/uom/uom.schemas.js
// Joi validation schemas for UOM (Unit of Measure) operations
// Centralized validation rules for better maintainability

const Joi = require('joi');

// Schema for creating a new UOM
const createUomSchema = Joi.object({
  UnitName: Joi.string().required().max(100).trim(),
  IsPrimary: Joi.boolean().optional().default(false),
  Active: Joi.boolean().optional().default(true),
});

// Schema for updating an existing UOM
const updateUomSchema = Joi.object({
  UnitName: Joi.string().optional().max(100).trim(),
  IsPrimary: Joi.boolean().optional(),
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
  createUomSchema,
  updateUomSchema,
  paginationSchema,
  uuidParamSchema,
};
