// src/modules/posorder/posorder.schemas.js
// Joi validation schemas for POS Order operations.

const Joi = require('joi');

const createSchema = Joi.object({
  OrderNo: Joi.string().required().max(50).allow(null).trim(),
  TableId: Joi.string().uuid().optional().allow(null),
  CustomerId: Joi.string().uuid().optional().allow(null),
  OrderType: Joi.string().optional().max(20).allow(null, '').trim(),
  Status: Joi.string().optional().max(20).allow(null, '').trim(),
  Items: Joi.alternatives(Joi.object(), Joi.array()).optional().allow(null),
  SubTotal: Joi.number().optional().default(0).allow(null),
  TaxAmount: Joi.number().optional().default(0).allow(null),
  Total: Joi.number().optional().default(0).allow(null),
  BranchDetailId: Joi.string().uuid().optional().allow(null),
  Active: Joi.boolean().optional().default(true),
});

const updateSchema = Joi.object({
  OrderNo: Joi.string().optional().max(50).allow(null, '').trim(),
  TableId: Joi.string().uuid().optional().allow(null),
  CustomerId: Joi.string().uuid().optional().allow(null),
  OrderType: Joi.string().optional().max(20).allow(null, '').trim(),
  Status: Joi.string().optional().max(20).allow(null, '').trim(),
  Items: Joi.alternatives(Joi.object(), Joi.array()).optional().allow(null),
  SubTotal: Joi.number().optional().allow(null),
  TaxAmount: Joi.number().optional().allow(null),
  Total: Joi.number().optional().allow(null),
  BranchDetailId: Joi.string().uuid().optional().allow(null),
  Active: Joi.boolean().optional(),
}).min(1);

const paginationSchema = Joi.object({
  page: Joi.number().integer().min(1).optional().default(1),
  limit: Joi.number().integer().min(1).max(100).optional().default(10),
});

const uuidParamSchema = Joi.object({
  id: Joi.string().uuid().required(),
});

// Table transfer — one of three shapes keyed by `scope`:
//   orders : reassign whole rounds        → { orderIds[], toTableId }
//   items  : split lines off one round     → { sourceOrderId, items[], toTableId }
//   merge  : fold one round into another   → { sourceOrderId, targetOrderId }  (reversal)
const transferItemSchema = Joi.object({
  index: Joi.number().integer().min(0).required(),
  qty: Joi.number().positive().required(),
});

const transferSchema = Joi.object({
  scope: Joi.string().valid('orders', 'items', 'merge').required(),
  toTableId: Joi.string().uuid().when('scope', {
    is: 'merge', then: Joi.optional().allow(null), otherwise: Joi.required(),
  }),
  orderIds: Joi.array().items(Joi.string().uuid()).min(1).when('scope', {
    is: 'orders', then: Joi.required(), otherwise: Joi.forbidden(),
  }),
  sourceOrderId: Joi.string().uuid().when('scope', {
    is: Joi.valid('items', 'merge'), then: Joi.required(), otherwise: Joi.forbidden(),
  }),
  targetOrderId: Joi.string().uuid().when('scope', {
    is: 'merge', then: Joi.required(), otherwise: Joi.forbidden(),
  }),
  items: Joi.array().items(transferItemSchema).min(1).when('scope', {
    is: 'items', then: Joi.required(), otherwise: Joi.forbidden(),
  }),
  destOrderNo: Joi.string().max(50).optional().allow(null, ''),
});

module.exports = { createSchema, updateSchema, paginationSchema, uuidParamSchema, transferSchema };
