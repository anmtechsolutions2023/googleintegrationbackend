// src/modules/batchdetail/batchdetail.schemas.js
const Joi = require('joi');

const createSchema = Joi.object({
  BatchNumber: Joi.string().required().max(100).trim(),
  ManufacturedDate: Joi.date().optional().allow(null),
  ExpiryDate: Joi.date().optional().allow(null),
  Active: Joi.boolean().optional().default(true),
});

const updateSchema = Joi.object({
  BatchNumber: Joi.string().optional().max(100).trim(),
  ManufacturedDate: Joi.date().optional().allow(null),
  ExpiryDate: Joi.date().optional().allow(null),
  Active: Joi.boolean().optional(),
}).min(1);

const paginationSchema = Joi.object({
  page: Joi.number().integer().min(1).optional().default(1),
  limit: Joi.number().integer().min(1).max(100).optional().default(10),
});

const uuidParamSchema = Joi.object({
  id: Joi.string().uuid().required(),
});

module.exports = {
  createSchema,
  updateSchema,
  paginationSchema,
  uuidParamSchema,
};
