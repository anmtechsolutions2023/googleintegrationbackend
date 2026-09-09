// src/modules/paymentbreakup/paymentbreakup.schemas.js
const Joi = require('joi');
const { entityId } = require('../../utils/idSchema');
const { joinedEchoes } = require('../../utils/joinedEchoes');
const { QUERIES } = require('../../config/constants');

const createSchema = Joi.object({
  // Every alias this module's SELECT joins in, accepted and dropped. An edit
  // form is seeded from a GET and sends the whole row back, so a joined column
  // would otherwise be rejected as an unknown key and refuse the whole save.
  // First in the literal, so the real rules below override any alias that is
  // also a genuine input.
  ...joinedEchoes(QUERIES.PAYMENT_BREAKUP),
  AccountTypeBaseId: entityId.required(),
  PaymentDetailId: entityId.required(),
  PaymentModeTransactionDetailId: entityId.required(),
  PaymentReceivedTypeId: entityId.required(),
  // Amount settled through this payment mode. Several breakups against one
  // paymentdetail make up a split settlement, and they should sum to its
  // TotalAmount.
  Amount: Joi.number().min(0).optional().default(0),
  UserId: entityId.optional().allow(null, ''),
  Timestamp: Joi.alternatives()
    .try(Joi.date().iso(), Joi.string().regex(/^\d{1,2}-\d{1,2}-\d{4}$/))
    .required(),
  Active: Joi.boolean().optional().default(true),
});

const updateSchema = Joi.object({
  // Every alias this module's SELECT joins in, accepted and dropped. An edit
  // form is seeded from a GET and sends the whole row back, so a joined column
  // would otherwise be rejected as an unknown key and refuse the whole save.
  // First in the literal, so the real rules below override any alias that is
  // also a genuine input.
  ...joinedEchoes(QUERIES.PAYMENT_BREAKUP),
  AccountTypeBaseId: entityId.optional(),
  PaymentDetailId: entityId.optional(),
  PaymentModeTransactionDetailId: entityId.optional(),
  PaymentReceivedTypeId: entityId.optional(),
  Amount: Joi.number().min(0).optional(),
  UserId: entityId.optional().allow(null, ''),
  Timestamp: Joi.alternatives()
    .try(Joi.date().iso(), Joi.string().regex(/^\d{1,2}-\d{1,2}-\d{4}$/))
    .optional(),
  Active: Joi.boolean().optional(),
}).min(1);

const paginationSchema = Joi.object({
  page: Joi.number().integer().min(1).optional().default(1),
  limit: Joi.number().integer().min(1).max(100).optional().default(10),
  expand: Joi.boolean().optional().default(false),
});

const uuidParamSchema = Joi.object({
  id: entityId.required(),
});

const getByIdQuerySchema = Joi.object({
  expand: Joi.boolean().optional().default(false),
});

module.exports = {
  createSchema,
  updateSchema,
  paginationSchema,
  uuidParamSchema,
  getByIdQuerySchema,
};
