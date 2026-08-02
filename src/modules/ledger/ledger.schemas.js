// src/modules/ledger/ledger.schemas.js
const Joi = require('joi');

const listQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).optional().default(1),
  limit: Joi.number().integer().min(1).max(100).optional().default(10),
  status: Joi.string().max(30).optional(),
  fromDate: Joi.date().iso().optional(),
  toDate: Joi.date().iso().optional(),
  contactDetailId: Joi.string().uuid().optional(),
  search: Joi.string().max(100).optional().allow(''),
});

const refundSchema = Joi.object({
  // Recorded on the reversing tender so a refund is never unexplained.
  Reason: Joi.string().max(100).optional().allow(null, ''),
});

const uuidParamSchema = Joi.object({ id: Joi.string().uuid().required() });

module.exports = { listQuerySchema, refundSchema, uuidParamSchema };
