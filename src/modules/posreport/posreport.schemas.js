// src/modules/posreport/posreport.schemas.js
// Joi validation schemas for POS Reports endpoint.

const Joi = require('joi');

const querySchema = Joi.object({
  days: Joi.number().integer().min(1).max(90).optional().default(7),
});

module.exports = { querySchema };
