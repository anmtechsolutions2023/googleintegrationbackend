// src/modules/gstexport/gstexport.schemas.js
const Joi = require('joi');
const { entityId } = require('../../utils/idSchema');

// Returns are filed by calendar month, so the pack is too.
const periodField = Joi.string().pattern(/^\d{4}-(0[1-9]|1[0-2])$/).required()
  .messages({ 'string.pattern.base': 'Month must look like 2026-08.' });

const packQuerySchema = Joi.object({
  period: periodField,
  // One GSTIN per return, and a GSTIN belongs to a branch.
  branchId: entityId.required(),
});

const withoutGstQuerySchema = Joi.object({
  fromDate: Joi.date().iso().required(),
  toDate: Joi.date().iso().min(Joi.ref('fromDate')).required(),
  branchId: entityId.optional(),
});

const filingSchema = Joi.object({
  period: periodField,
  branchId: entityId.required(),
  filedOn: Joi.date().iso().required(),
});

module.exports = { packQuerySchema, withoutGstQuerySchema, filingSchema };
