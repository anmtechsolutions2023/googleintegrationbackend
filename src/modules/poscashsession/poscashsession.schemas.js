// src/modules/poscashsession/poscashsession.schemas.js
// Joi validation schemas for cash sessions.
//
// ExpectedCash and Variance are never accepted from the client: both are derived
// from the ledger at close time. Letting a till declare its own expectation
// would make the variance meaningless.

const Joi = require('joi');

const openSchema = Joi.object({
  BranchDetailId: Joi.string().uuid().required(),
  // Defaults to the caller — a cashier opens their own till.
  CashierEmail: Joi.string().email().optional().allow(null),
  ShiftLabel: Joi.string().max(50).optional().allow(null, '').trim(),
  OpeningFloat: Joi.number().min(0).optional().default(0),
});

const closeSchema = Joi.object({
  CountedCash: Joi.number().min(0).required(),
  Notes: Joi.string().max(500).optional().allow(null, '').trim(),
});

const paginationSchema = Joi.object({
  page: Joi.number().integer().min(1).optional().default(1),
  limit: Joi.number().integer().min(1).max(100).optional().default(10),
});

const uuidParamSchema = Joi.object({
  id: Joi.string().uuid().required(),
});

module.exports = { openSchema, closeSchema, paginationSchema, uuidParamSchema };
