// src/modules/posrejectionreason/posrejectionreason.schemas.js
// Joi validation schemas for POS Rejection Reason master operations.

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
  ...joinedEchoes(QUERIES.POS_REJECTION_REASON),
  Name: Joi.string().max(100).trim().required(),
  Code: Joi.string().max(50).trim().required(),
  // The portal's own code. Left null until certification maps it — inventing
  // one would push a value a live API rejects on the first refusal.
  ExternalCode: Joi.string().max(50).trim().allow('', null).optional(),
  // null = a house reason, offered on every portal.
  PortalId: optionalEntityId,
  // Set on an out-of-stock reason: the portal has to be told WHICH dish ran
  // out, and the reject path refuses a rejection that cannot say.
  RequiresItems: Joi.boolean().optional().default(false),
  Description: Joi.string().max(255).trim().allow('', null).optional(),
  SortOrder: Joi.number().integer().optional().default(0),
  Active: Joi.boolean().optional().default(true),
});

const updateSchema = Joi.object({
  // Every alias this module's SELECT joins in, accepted and dropped. An edit
  // form is seeded from a GET and sends the whole row back, so a joined column
  // would otherwise be rejected as an unknown key and refuse the whole save.
  // First in the literal, so the real rules below override any alias that is
  // also a genuine input.
  ...joinedEchoes(QUERIES.POS_REJECTION_REASON),
  Name: Joi.string().max(100).trim().optional(),
  Code: Joi.string().max(50).trim().optional(),
  ExternalCode: Joi.string().max(50).trim().allow('', null).optional(),
  PortalId: optionalEntityId,
  RequiresItems: Joi.boolean().optional(),
  Description: Joi.string().max(255).trim().allow('', null).optional(),
  SortOrder: Joi.number().integer().optional(),
  Active: Joi.boolean().optional(),
}).min(1);

const paginationSchema = Joi.object({
  page: Joi.number().integer().min(1).optional().default(1),
  limit: Joi.number().integer().min(1).max(100).optional().default(10),
});

const uuidParamSchema = Joi.object({
  id: entityId.required(),
});

const portalParamSchema = Joi.object({
  portalId: entityId.required(),
});

module.exports = {
  createSchema,
  updateSchema,
  paginationSchema,
  uuidParamSchema,
  portalParamSchema,
};
