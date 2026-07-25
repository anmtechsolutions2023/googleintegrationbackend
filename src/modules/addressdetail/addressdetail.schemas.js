// src/modules/addressdetail/addressdetail.schemas.js
const Joi = require('joi');

const createSchema = Joi.object({
  AddressLine1: Joi.string().required().max(50).trim(),
  AddressLine2: Joi.string().optional().max(50).trim().allow(null, ''),
  City: Joi.string().optional().max(50).trim().allow(null, ''),
  State: Joi.string().optional().max(50).trim().allow(null, ''),
  Pincode: Joi.string().optional().max(50).trim().allow(null, ''),
  MapProviderLocationMapperId: Joi.string().uuid().optional().allow(null),
  Landmark: Joi.string().optional().max(50).trim().allow(null, ''),
  ContactAddressTypeId: Joi.string().uuid().required(),
  TagName: Joi.string().max(100).required(),
  Active: Joi.boolean().optional().default(true),
});

const updateSchema = Joi.object({
  AddressLine1: Joi.string().optional().max(50).trim(),
  AddressLine2: Joi.string().optional().max(50).trim().allow(null, ''),
  City: Joi.string().optional().max(50).trim().allow(null, ''),
  State: Joi.string().optional().max(50).trim().allow(null, ''),
  Pincode: Joi.string().optional().max(50).trim().allow(null, ''),
  MapProviderLocationMapperId: Joi.string().uuid().optional().allow(null),
  Landmark: Joi.string().optional().max(50).trim().allow(null, ''),
  ContactAddressTypeId: Joi.string().uuid().optional(),
  TagName: Joi.string().max(100).optional(),
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
  createSchema,
  updateSchema,
  paginationSchema,
  uuidParamSchema,
  getByIdQuerySchema,
};
