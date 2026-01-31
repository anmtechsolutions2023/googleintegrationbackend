// src/modules/costinfo/costinfo.schemas.js
const Joi = require('joi');

const createSchema = Joi.object({
  Amount: Joi.number().precision(4).required(),
  TaxGroupId: Joi.string().uuid().optional().allow(null),
  IsTaxIncluded: Joi.boolean().optional().default(false),
  Active: Joi.boolean().optional().default(true),
});

const updateSchema = Joi.object({
  Amount: Joi.number().precision(4).optional(),
  TaxGroupId: Joi.string().uuid().optional().allow(null),
  IsTaxIncluded: Joi.boolean().optional(),
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
