// src/modules/transactiondetaillog/transactiondetaillog.schemas.js
const Joi = require('joi');

const createSchema = Joi.object({
  TransactionNo: Joi.string().required().max(100).trim(),
  TransactionTypeConfigId: Joi.string().uuid().required(),
  TransactionTypeStatusId: Joi.string().uuid().optional().allow(null),
  BranchId: Joi.string().uuid().optional().allow(null),
  TransactionDate: Joi.date().optional().allow(null),
  Remarks: Joi.string().optional().max(1000).trim().allow(null, ''),
  Active: Joi.boolean().optional().default(true),
});

const updateSchema = Joi.object({
  TransactionNo: Joi.string().optional().max(100).trim(),
  TransactionTypeConfigId: Joi.string().uuid().optional(),
  TransactionTypeStatusId: Joi.string().uuid().optional().allow(null),
  BranchId: Joi.string().uuid().optional().allow(null),
  TransactionDate: Joi.date().optional().allow(null),
  Remarks: Joi.string().optional().max(1000).trim().allow(null, ''),
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
