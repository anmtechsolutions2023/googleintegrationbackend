// src/modules/locationdetail/locationdetail.schemas.js
const Joi = require('joi');

const createSchema = Joi.object({
  Lat: Joi.number().precision(8).required(),
  Lng: Joi.number().precision(8).required(),
  CF1: Joi.string().optional().max(255).trim().allow(null, ''),
  CF2: Joi.string().optional().max(255).trim().allow(null, ''),
  CF3: Joi.string().optional().max(255).trim().allow(null, ''),
  CF4: Joi.string().optional().max(255).trim().allow(null, ''),
  Active: Joi.boolean().optional().default(true),
});

const updateSchema = Joi.object({
  Lat: Joi.number().precision(8).optional(),
  Lng: Joi.number().precision(8).optional(),
  CF1: Joi.string().optional().max(255).trim().allow(null, ''),
  CF2: Joi.string().optional().max(255).trim().allow(null, ''),
  CF3: Joi.string().optional().max(255).trim().allow(null, ''),
  CF4: Joi.string().optional().max(255).trim().allow(null, ''),
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
