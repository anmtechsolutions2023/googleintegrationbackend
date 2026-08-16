// src/modules/posorder/posorder.schemas.js
// Joi validation schemas for POS Order operations.

const Joi = require('joi');
const { POS_ORDER_STATUSES, POS_ORDER_TYPES } = require('../../config/constants');

// Canonical lowercase enums, normalized on write. Status and OrderType were both
// free-text before, which is how 'Active'/'open' and 'Dine-in'/'dinein' ended up
// coexisting in the same column.
const statusField = Joi.string().lowercase().valid(...POS_ORDER_STATUSES);
const orderTypeField = Joi.string().lowercase().valid(...POS_ORDER_TYPES);

// OrderNo is issued server-side from the POS_ORDER numbering series. The client
// used to generate it from the last 6 digits of Date.now(), which wrapped every
// ~16m40s and collided with UNIQUE (OrderNo, TenantId). Any value sent is ignored.
const createSchema = Joi.object({
  OrderNo: Joi.string().optional().max(50).allow(null, '').trim(),
  TableId: Joi.string().uuid().optional().allow(null),
  CustomerId: Joi.string().uuid().optional().allow(null),
  OrderType: orderTypeField.optional().allow(null, '').default('dinein'),
  // A round is born open — the client does not choose this. Both columns are
  // NOT NULL, so an omitted Status has to resolve to a value before it reaches
  // the INSERT (see prepareInsertParams).
  Status: statusField.optional().allow(null, '').default('open'),
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
  OrderType: orderTypeField.optional().allow(null, ''),
  Status: statusField.optional().allow(null, ''),
  Items: Joi.alternatives(Joi.object(), Joi.array()).optional().allow(null),
  SubTotal: Joi.number().optional().allow(null),
  TaxAmount: Joi.number().optional().allow(null),
  Total: Joi.number().optional().allow(null),
  BranchDetailId: Joi.string().uuid().optional().allow(null),
  Active: Joi.boolean().optional(),
}).min(1);

// Both filters are optional, and omitting them yields the original unfiltered
// list — existing callers are unaffected.
const paginationSchema = Joi.object({
  page: Joi.number().integer().min(1).optional().default(1),
  limit: Joi.number().integer().min(1).max(100).optional().default(10),
  // One table's rounds. Lets Billing resume an occupied table's session without
  // pulling and locally filtering the whole (page-capped) order list.
  tableId: Joi.string().uuid().optional(),
  // Only rounds still part of a live session — a settled table must not look
  // occupied just because it traded earlier today.
  openOnly: Joi.boolean().optional().default(false),
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
