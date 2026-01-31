// src/modules/mapproviderlocationmapper/mapproviderlocationmapper.schemas.js
const Joi = require('joi');

const createSchema = Joi.object({
  MapProviderId: Joi.string().uuid().required(),
  LocationDetailId: Joi.string().uuid().required(),
  Active: Joi.boolean().optional().default(true),
});

const updateSchema = Joi.object({
  MapProviderId: Joi.string().uuid().optional(),
  LocationDetailId: Joi.string().uuid().optional(),
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
