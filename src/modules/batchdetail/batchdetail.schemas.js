// src/modules/batchdetail/batchdetail.schemas.js
const Joi = require('joi')
const { taxBreakdownEcho } = require('../pricing/pricing.enrich');

const createSchema = Joi.object({
  BatchNo: Joi.string().required().max(100).trim(),
  Barcode: Joi.string().optional().max(100).trim().allow(null, ''),
  MfgDate: Joi.alternatives()
    .try(Joi.date().iso(), Joi.string().regex(/^\d{1,2}-\d{1,2}-\d{4}$/))
    .optional()
    .allow(null),
  Expdate: Joi.alternatives()
    .try(Joi.date().iso(), Joi.string().regex(/^\d{1,2}-\d{1,2}-\d{4}$/))
    .optional()
    .allow(null),
  PurchaseDate: Joi.alternatives()
    .try(Joi.date().iso(), Joi.string().regex(/^\d{1,2}-\d{1,2}-\d{4}$/))
    .optional()
    .allow(null),
  IsNonReturnable: Joi.boolean().optional().default(false),
  CostInfoId: Joi.string().uuid().optional().allow(null),
  UOMId: Joi.string().uuid().optional().allow(null),
  Quantity: Joi.number().precision(4).optional().allow(null),
  MapProviderLocationMapperId: Joi.string().uuid().optional().allow(null),
  BranchDetailId: Joi.string().uuid().optional().allow(null),
  Active: Joi.boolean().optional().default(true),
  TaxBreakdown: taxBreakdownEcho(),
})

const updateSchema = Joi.object({
  BatchNo: Joi.string().optional().max(100).trim(),
  Barcode: Joi.string().optional().max(100).trim().allow(null, ''),
  MfgDate: Joi.alternatives()
    .try(Joi.date().iso(), Joi.string().pattern(/^\d{1,2}-\d{1,2}-\d{4}$/))
    .optional()
    .allow(null),
  Expdate: Joi.alternatives()
    .try(Joi.date().iso(), Joi.string().pattern(/^\d{1,2}-\d{1,2}-\d{4}$/))
    .optional()
    .allow(null),
  PurchaseDate: Joi.alternatives()
    .try(Joi.date().iso(), Joi.string().pattern(/^\d{1,2}-\d{1,2}-\d{4}$/))
    .optional()
    .allow(null),
  IsNonReturnable: Joi.boolean().optional(),
  CostInfoId: Joi.string().uuid().optional().allow(null),
  UOMId: Joi.string().uuid().optional().allow(null),
  Quantity: Joi.number().precision(4).optional().allow(null),
  MapProviderLocationMapperId: Joi.string().uuid().optional().allow(null),
  BranchDetailId: Joi.string().uuid().optional().allow(null),
  Active: Joi.boolean().optional(),
  TaxBreakdown: taxBreakdownEcho(),
}).min(1)

const paginationSchema = Joi.object({
  page: Joi.number().integer().min(1).optional().default(1),
  limit: Joi.number().integer().min(1).max(100).optional().default(10),
  expand: Joi.boolean().optional().default(false),
})

const uuidParamSchema = Joi.object({
  id: Joi.string().uuid().required(),
})

const getByIdQuerySchema = Joi.object({
  expand: Joi.boolean().optional(),
})

module.exports = {
  createSchema,
  updateSchema,
  paginationSchema,
  uuidParamSchema,
  getByIdQuerySchema,
}
