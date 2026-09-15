// src/modules/posfeedback/posfeedback.schemas.js
// Joi validation schemas for POS Feedback operations.

const Joi = require('joi');
const { entityId, optionalEntityId } = require('../../utils/idSchema');
const { joinedEchoes } = require('../../utils/joinedEchoes');
const { QUERIES } = require('../../config/constants');

const createSchema = Joi.object({
  // Every alias this module's SELECT joins in, accepted and dropped. An edit
  // form is seeded from a GET and sends the whole row back, so a joined column
  // would otherwise be rejected as an unknown key and refuse the whole save.
  // First in the literal, so the real rules below override any alias that is
  // also a genuine input.
  ...joinedEchoes(QUERIES.POS_FEEDBACK),
  CustomerId: optionalEntityId,
  CustomerName: Joi.string().optional().max(100).allow(null, '').trim(),
  Rating: Joi.number().integer().min(1).max(5).required(),
  Comments: Joi.string().optional().max(1000).allow(null, '').trim(),
  // WHICH VISIT this is about. Optional because a comment card left at the door
  // is still worth keeping, but a rating that names its order is the one that
  // can be traced to a table, a token and the food that was served.
  OrderId: optionalEntityId,
  BranchDetailId: optionalEntityId,
  Active: Joi.boolean().optional().default(true),
});

const updateSchema = Joi.object({
  // Every alias this module's SELECT joins in, accepted and dropped. An edit
  // form is seeded from a GET and sends the whole row back, so a joined column
  // would otherwise be rejected as an unknown key and refuse the whole save.
  // First in the literal, so the real rules below override any alias that is
  // also a genuine input.
  ...joinedEchoes(QUERIES.POS_FEEDBACK),
  CustomerId: optionalEntityId,
  CustomerName: Joi.string().optional().max(100).allow(null, '').trim(),
  Rating: Joi.number().integer().optional().allow(null),
  Comments: Joi.string().optional().max(1000).allow(null, '').trim(),
  OrderId: optionalEntityId,
  BranchDetailId: optionalEntityId,
  Active: Joi.boolean().optional(),
}).min(1);

const paginationSchema = Joi.object({
  page: Joi.number().integer().min(1).optional().default(1),
  limit: Joi.number().integer().min(1).max(100).optional().default(10),
});

const uuidParamSchema = Joi.object({
  id: entityId.required(),
});

module.exports = { createSchema, updateSchema, paginationSchema, uuidParamSchema };
