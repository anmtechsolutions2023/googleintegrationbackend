// src/modules/posdine/dine.schemas.js
// Joi schemas for the public diner endpoints.
//
// Deliberately narrow. Anything a guest's phone might send beyond these fields
// — a price, a discount, a table, a customer, a dish name — is rejected by
// Joi's default of refusing unknown keys, rather than silently ignored.

const Joi = require('joi');
const { entityId } = require('../../utils/idSchema');
const { phoneField } = require('../../utils/phoneSchema');
const { QR_ORDERING, KITCHEN_NOTES } = require('../../config/constants');
const MESSAGES = require('../../config/messages');
const { TOKEN_PATTERN } = require('../posqr/posqr.token');

const tokenParamSchema = Joi.object({
  token: Joi.string().pattern(TOKEN_PATTERN).required()
    .messages({ 'string.pattern.base': MESSAGES.ERROR.QR_NOT_AVAILABLE }),
});

const requestCodeSchema = Joi.object({
  phone: phoneField().required(),
});

const verifyCodeSchema = Joi.object({
  challengeId: Joi.string().max(64).required(),
  code: Joi.string().pattern(/^\d{4,8}$/).required()
    .messages({ 'string.pattern.base': MESSAGES.ERROR.OTP_INVALID }),
  // Optional: asked only on a first visit, and a guest may skip it.
  name: Joi.string().trim().max(100).allow('', null).optional(),
});

const lineSchema = Joi.object({
  id: entityId.required(),
  quantity: Joi.number().integer().min(1).max(QR_ORDERING.MAX_QUANTITY).required(),
  variantIds: Joi.array().items(entityId).max(10).default([]),
  addonIds: Joi.array().items(entityId).max(30).default([]),
  note: Joi.string().trim().max(KITCHEN_NOTES.LINE_MAX).allow('', null).optional(),
});

const itemsField = Joi.array().items(lineSchema).min(1).max(QR_ORDERING.MAX_LINES).required()
  .messages({ 'array.min': MESSAGES.ERROR.QR_EMPTY_ORDER });

const quoteSchema = Joi.object({ items: itemsField });

const nameSchema = Joi.object({
  name: Joi.string().trim().min(1).max(100).required(),
});

const placeOrderSchema = Joi.object({
  items: itemsField,
  cookingInstructions: Joi.string().trim().max(KITCHEN_NOTES.ORDER_MAX).allow('', null).optional(),
});

module.exports = {
  tokenParamSchema,
  requestCodeSchema,
  verifyCodeSchema,
  quoteSchema,
  placeOrderSchema,
  nameSchema,
};
