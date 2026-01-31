// src/modules/accounttypebase/accounttypebase.schemas.js
const Joi = require('joi');

const createAccountTypeBaseSchema = Joi.object({
  Name: Joi.string().required().max(100).trim(),
  Active: Joi.boolean().optional().default(true),
});

const updateAccountTypeBaseSchema = Joi.object({
  Name: Joi.string().optional().max(100).trim(),
  Active: Joi.boolean().optional(),
}).min(1);

const paginationSchema = Joi.object({
  page: Joi.number().integer().min(1).optional().default(1),
  limit: Joi.number().integer().min(1).max(100).optional().default(10),
});

const uuidParamSchema = Joi.object({
  id: Joi.string().uuid().required(),
});

module.exports = {
  createAccountTypeBaseSchema,
  updateAccountTypeBaseSchema,
  paginationSchema,
  uuidParamSchema,
};
