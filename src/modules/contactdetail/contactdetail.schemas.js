// src/modules/contactdetail/contactdetail.schemas.js
const Joi = require('joi');

const createSchema = Joi.object({
  FirstName: Joi.string().required().max(100).trim(),
  LastName: Joi.string().optional().max(100).trim().allow(null, ''),
  MobileNo: Joi.string().optional().max(20).trim().allow(null, ''),
  AltMobileNo: Joi.string().optional().max(20).trim().allow(null, ''),
  Landline1: Joi.string().optional().max(20).trim().allow(null, ''),
  LandLine2: Joi.string().optional().max(20).trim().allow(null, ''),
  Ext1: Joi.string().optional().max(10).trim().allow(null, ''),
  Ext2: Joi.string().optional().max(10).trim().allow(null, ''),
  ContactAddressTypeId: Joi.string().uuid().optional().allow(null),
  Active: Joi.boolean().optional().default(true),
});

const updateSchema = Joi.object({
  FirstName: Joi.string().optional().max(100).trim(),
  LastName: Joi.string().optional().max(100).trim().allow(null, ''),
  MobileNo: Joi.string().optional().max(20).trim().allow(null, ''),
  AltMobileNo: Joi.string().optional().max(20).trim().allow(null, ''),
  Landline1: Joi.string().optional().max(20).trim().allow(null, ''),
  LandLine2: Joi.string().optional().max(20).trim().allow(null, ''),
  Ext1: Joi.string().optional().max(10).trim().allow(null, ''),
  Ext2: Joi.string().optional().max(10).trim().allow(null, ''),
  ContactAddressTypeId: Joi.string().uuid().optional().allow(null),
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
