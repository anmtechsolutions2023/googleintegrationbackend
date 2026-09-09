// src/modules/posaddongroup/posaddongroup.schemas.js
// Joi validation schemas for POS Add-on Group master operations.

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
  ...joinedEchoes(QUERIES.POS_ADDON_GROUP),
  Name: Joi.string().max(100).trim().required(),
  Code: Joi.string().max(50).trim().required(),
  Description: Joi.string().max(255).trim().allow('', null).optional(),
  // 0 means the group is optional; anything higher makes it mandatory.
  MinSelection: Joi.number().integer().min(0).optional().default(0),
  // At least one, or the group offers choices nobody may take.
  MaxSelection: Joi.number().integer().min(1).optional().default(1),
  SortOrder: Joi.number().integer().optional().default(0),
  Active: Joi.boolean().optional().default(true),
});

const updateSchema = Joi.object({
  // Every alias this module's SELECT joins in, accepted and dropped. An edit
  // form is seeded from a GET and sends the whole row back, so a joined column
  // would otherwise be rejected as an unknown key and refuse the whole save.
  // First in the literal, so the real rules below override any alias that is
  // also a genuine input.
  ...joinedEchoes(QUERIES.POS_ADDON_GROUP),
  Name: Joi.string().max(100).trim().optional(),
  Code: Joi.string().max(50).trim().optional(),
  Description: Joi.string().max(255).trim().allow('', null).optional(),
  MinSelection: Joi.number().integer().min(0).optional(),
  MaxSelection: Joi.number().integer().min(1).optional(),
  SortOrder: Joi.number().integer().optional(),
  Active: Joi.boolean().optional(),
}).min(1);
// NOTE: min ≤ max is NOT enforced here. On a partial update either field may be
// absent, so the comparison needs the stored row — it lives in the service.

const paginationSchema = Joi.object({
  page: Joi.number().integer().min(1).optional().default(1),
  limit: Joi.number().integer().min(1).max(100).optional().default(10),
});

const uuidParamSchema = Joi.object({
  id: entityId.required(),
});

module.exports = { createSchema, updateSchema, paginationSchema, uuidParamSchema };
