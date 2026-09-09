// src/modules/paymentmode/paymentmode.schemas.js
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
  ...joinedEchoes(QUERIES.PAYMENT_MODE),
  Type: Joi.string().required().max(50).trim(),
  Active: Joi.boolean().optional().default(true),
});

const updateSchema = Joi.object({
  // Every alias this module's SELECT joins in, accepted and dropped. An edit
  // form is seeded from a GET and sends the whole row back, so a joined column
  // would otherwise be rejected as an unknown key and refuse the whole save.
  // First in the literal, so the real rules below override any alias that is
  // also a genuine input.
  ...joinedEchoes(QUERIES.PAYMENT_MODE),
  Type: Joi.string().optional().max(50).trim(),
  Active: Joi.boolean().optional(),
}).min(1);

const paginationSchema = Joi.object({
  page: Joi.number().integer().min(1).optional().default(1),
  limit: Joi.number().integer().min(1).max(100).optional().default(10),
});

const uuidParamSchema = Joi.object({
  id: entityId.required(),
});

module.exports = {
  createSchema,
  updateSchema,
  paginationSchema,
  uuidParamSchema,
};
