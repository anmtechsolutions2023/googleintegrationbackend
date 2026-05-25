// src/modules/branchdetail/branchdetail.schemas.js
const Joi = require('joi')

const createSchema = Joi.object({
  BranchName: Joi.string().max(100).trim(),
  // legacy alias support: accept `Name` from older clients
  Name: Joi.string().max(100).trim(),
  AddressDetailId: Joi.string().uuid().optional().allow(null),
  ContactDetailId: Joi.string().uuid().optional().allow(null),
  OrganizationDetailId: Joi.string().uuid().optional().allow(null),
  // legacy alias support
  OrganizationId: Joi.string().uuid().optional().allow(null),
  TransactionTypeConfigId: Joi.string().uuid().optional().allow(null),
  TINNo: Joi.string().optional().max(50).allow(null, ''),
  GSTIN: Joi.string().optional().max(50).allow(null, ''),
  PAN: Joi.string().optional().max(50).allow(null, ''),
  CF1: Joi.string().optional().max(50).allow(null, ''),
  CF2: Joi.string().optional().max(50).allow(null, ''),
  CF3: Joi.string().optional().max(50).allow(null, ''),
  CF4: Joi.string().optional().max(50).allow(null, ''),
  Active: Joi.boolean().optional().default(true),
}).or('BranchName', 'Name')

const updateSchema = Joi.object({
  BranchName: Joi.string().optional().max(100).trim(),
  Name: Joi.string().optional().max(100).trim(),
  AddressDetailId: Joi.string().uuid().optional().allow(null),
  ContactDetailId: Joi.string().uuid().optional().allow(null),
  OrganizationDetailId: Joi.string().uuid().optional().allow(null),
  // legacy alias support
  OrganizationId: Joi.string().uuid().optional().allow(null),
  TransactionTypeConfigId: Joi.string().uuid().optional().allow(null),
  TINNo: Joi.string().optional().max(50).allow(null, ''),
  GSTIN: Joi.string().optional().max(50).allow(null, ''),
  PAN: Joi.string().optional().max(50).allow(null, ''),
  CF1: Joi.string().optional().max(50).allow(null, ''),
  CF2: Joi.string().optional().max(50).allow(null, ''),
  CF3: Joi.string().optional().max(50).allow(null, ''),
  CF4: Joi.string().optional().max(50).allow(null, ''),
  Active: Joi.boolean().optional(),
})
  .min(1)
  .or('BranchName', 'Name')

const paginationSchema = Joi.object({
  page: Joi.number().integer().min(1).optional().default(1),
  limit: Joi.number().integer().min(1).max(100).optional().default(10),
  expand: Joi.boolean().optional().default(false),
})

const getByIdQuerySchema = Joi.object({
  expand: Joi.boolean().optional().default(false),
})

const uuidParamSchema = Joi.object({
  id: Joi.string().uuid().required(),
})

module.exports = {
  createSchema,
  updateSchema,
  paginationSchema,
  uuidParamSchema,
  getByIdQuerySchema,
}
