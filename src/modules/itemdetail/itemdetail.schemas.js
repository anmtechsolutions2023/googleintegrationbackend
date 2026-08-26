// src/modules/itemdetail/itemdetail.schemas.js
const Joi = require('joi');
const { taxBreakdownEcho } = require('../pricing/pricing.enrich');

const createSchema = Joi.object({
  Name: Joi.string().required().max(255).trim(),
  Code: Joi.string().optional().max(50).trim().allow(null, ''),
  Description: Joi.string().optional().max(1000).trim().allow(null, ''),
  CategoryId: Joi.string().uuid().optional().allow(null),
  UOMId: Joi.string().uuid().optional().allow(null),
  CostInfoId: Joi.string().uuid().optional().allow(null),
  SKU: Joi.string().optional().max(100).trim().allow(null, ''),
  Barcode: Joi.string().optional().max(100).trim().allow(null, ''),
  HSNCode: Joi.string().optional().max(50).trim().allow(null, ''),
  Active: Joi.boolean().optional().default(true),
  TaxBreakdown: taxBreakdownEcho(),
});

const updateSchema = Joi.object({
  Name: Joi.string().optional().max(255).trim(),
  Code: Joi.string().optional().max(50).trim().allow(null, ''),
  Description: Joi.string().optional().max(1000).trim().allow(null, ''),
  CategoryId: Joi.string().uuid().optional().allow(null),
  UOMId: Joi.string().uuid().optional().allow(null),
  CostInfoId: Joi.string().uuid().optional().allow(null),
  SKU: Joi.string().optional().max(100).trim().allow(null, ''),
  Barcode: Joi.string().optional().max(100).trim().allow(null, ''),
  HSNCode: Joi.string().optional().max(50).trim().allow(null, ''),
  Active: Joi.boolean().optional(),
  TaxBreakdown: taxBreakdownEcho(),
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
