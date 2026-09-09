// src/modules/addressdetail/addressdetail.schemas.js
const Joi = require('joi');
const { entityId } = require('../../utils/idSchema');
const { joinedEchoes } = require('../../utils/joinedEchoes');
const { QUERIES } = require('../../config/constants');

const createSchema = Joi.object({
  // Every alias this module's SELECT joins in, accepted and dropped. An edit
  // form is seeded from a GET and sends the whole row back, so a joined column
  // would otherwise be rejected as an unknown key and refuse the whole save.
  // First in the literal, so the real rules below override any alias that is
  // also a genuine input.
  ...joinedEchoes(QUERIES.ADDRESS_DETAIL),
  AddressLine1: Joi.string().required().max(50).trim(),
  AddressLine2: Joi.string().optional().max(50).trim().allow(null, ''),
  City: Joi.string().optional().max(50).trim().allow(null, ''),
  State: Joi.string().optional().max(50).trim().allow(null, ''),
  Pincode: Joi.string().optional().max(50).trim().allow(null, ''),
  MapProviderLocationMapperId: entityId.optional().allow(null),
  Landmark: Joi.string().optional().max(50).trim().allow(null, ''),
  ContactAddressTypeId: entityId.required(),
  TagName: Joi.string().max(100).required(),
  Active: Joi.boolean().optional().default(true),
});

const updateSchema = Joi.object({
  // Every alias this module's SELECT joins in, accepted and dropped. An edit
  // form is seeded from a GET and sends the whole row back, so a joined column
  // would otherwise be rejected as an unknown key and refuse the whole save.
  // First in the literal, so the real rules below override any alias that is
  // also a genuine input.
  ...joinedEchoes(QUERIES.ADDRESS_DETAIL),
  AddressLine1: Joi.string().optional().max(50).trim(),
  AddressLine2: Joi.string().optional().max(50).trim().allow(null, ''),
  City: Joi.string().optional().max(50).trim().allow(null, ''),
  State: Joi.string().optional().max(50).trim().allow(null, ''),
  Pincode: Joi.string().optional().max(50).trim().allow(null, ''),
  MapProviderLocationMapperId: entityId.optional().allow(null),
  Landmark: Joi.string().optional().max(50).trim().allow(null, ''),
  ContactAddressTypeId: entityId.optional(),
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
  id: entityId.required(),
});

module.exports = {
  createSchema,
  updateSchema,
  paginationSchema,
  uuidParamSchema,
  getByIdQuerySchema,
};
