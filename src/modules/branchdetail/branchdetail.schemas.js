// src/modules/branchdetail/branchdetail.schemas.js
const Joi = require('joi')
const { entityId } = require('../../utils/idSchema');
const { joinedEchoes } = require('../../utils/joinedEchoes');
const { QUERIES } = require('../../config/constants');

const createSchema = Joi.object({
  // Every alias this module's SELECT joins in, accepted and dropped. An edit
  // form is seeded from a GET and sends the whole row back, so a joined column
  // would otherwise be rejected as an unknown key and refuse the whole save.
  // First in the literal, so the real rules below override any alias that is
  // also a genuine input.
  ...joinedEchoes(QUERIES.BRANCH_DETAIL),
  BranchName: Joi.string().max(100).trim(),
  // legacy alias support: accept `Name` from older clients
  Name: Joi.string().max(100).trim(),
  AddressDetailId: entityId.optional().allow(null),
  ContactDetailId: entityId.optional().allow(null),
  OrganizationDetailId: entityId.optional().allow(null),
  // legacy alias support
  OrganizationId: entityId.optional().allow(null),
  TransactionTypeConfigId: entityId.optional().allow(null),
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
  // Every alias this module's SELECT joins in, accepted and dropped. An edit
  // form is seeded from a GET and sends the whole row back, so a joined column
  // would otherwise be rejected as an unknown key and refuse the whole save.
  // First in the literal, so the real rules below override any alias that is
  // also a genuine input.
  ...joinedEchoes(QUERIES.BRANCH_DETAIL),
  BranchName: Joi.string().optional().max(100).trim(),
  Name: Joi.string().optional().max(100).trim(),
  AddressDetailId: entityId.optional().allow(null),
  ContactDetailId: entityId.optional().allow(null),
  OrganizationDetailId: entityId.optional().allow(null),
  // legacy alias support
  OrganizationId: entityId.optional().allow(null),
  TransactionTypeConfigId: entityId.optional().allow(null),
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
  id: entityId.required(),
})

module.exports = {
  createSchema,
  updateSchema,
  paginationSchema,
  uuidParamSchema,
  getByIdQuerySchema,
}
