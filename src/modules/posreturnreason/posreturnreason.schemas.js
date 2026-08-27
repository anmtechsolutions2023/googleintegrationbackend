// src/modules/posreturnreason/posreturnreason.schemas.js
// Joi validation for the return-reason master.

const Joi = require('joi');

const createSchema = Joi.object({
  Name: Joi.string().max(100).trim().required(),
  Code: Joi.string().max(50).trim().uppercase().required(),
  Description: Joi.string().max(255).trim().allow('', null).optional(),
  // Does this reason mean WE got it wrong? The split that turns a refund report
  // into a kitchen-quality signal.
  IsFault: Joi.boolean().optional().default(false),
  SortOrder: Joi.number().integer().optional().default(0),
  Active: Joi.boolean().optional().default(true),
});

const updateSchema = Joi.object({
  Name: Joi.string().max(100).trim().optional(),
  Code: Joi.string().max(50).trim().uppercase().optional(),
  Description: Joi.string().max(255).trim().allow('', null).optional(),
  IsFault: Joi.boolean().optional(),
  SortOrder: Joi.number().integer().optional(),
  Active: Joi.boolean().optional(),
}).min(1);

const paginationSchema = Joi.object({
  page: Joi.number().integer().min(1).optional().default(1),
  limit: Joi.number().integer().min(1).max(100).optional().default(10),
});

const uuidParamSchema = Joi.object({ id: Joi.string().uuid().required() });

module.exports = { createSchema, updateSchema, paginationSchema, uuidParamSchema };
