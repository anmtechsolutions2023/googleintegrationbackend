// src/modules/uomfactor/uomfactor.schemas.js
const Joi = require('joi');

const createUomFactorSchema = Joi.object({
  PrimaryUOMId: Joi.string().uuid().required(),
  SecondaryUOMId: Joi.string().uuid().required(),
  Factor: Joi.number().min(0).precision(6).required(),
  Active: Joi.boolean().optional().default(true),
});

const updateUomFactorSchema = Joi.object({
  PrimaryUOMId: Joi.string().uuid().optional(),
  SecondaryUOMId: Joi.string().uuid().optional(),
  Factor: Joi.number().min(0).precision(6).optional(),
  Active: Joi.boolean().optional(),
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
  id: Joi.string().uuid().required(),
});

module.exports = {
  createUomFactorSchema,
  updateUomFactorSchema,
  paginationSchema,
  uuidParamSchema,
  getByIdQuerySchema,
};
