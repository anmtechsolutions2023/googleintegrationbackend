// src/utils/gstinSchema.js
// One Joi rule for a GSTIN, shared by every write that can set one: the branch
// form, the setup wizard and the GST settings screen. Three copies of a pattern
// is how one of them ends up accepting a pasted phone number.

const Joi = require('joi');
const { GSTIN_PATTERN, stateCodeOf } = require('./gstStates');

/**
 * Optional GSTIN. Blank and null both mean "none"; anything else is trimmed,
 * upper-cased, and must be a well-formed GSTIN starting with a real state code.
 */
const gstinField = Joi.string()
  .trim()
  .uppercase()
  .allow('', null)
  .pattern(GSTIN_PATTERN)
  .custom((value, helpers) => (stateCodeOf(value) ? value : helpers.error('gstin.state')))
  .messages({
    'string.pattern.base': 'GSTIN must be 15 characters, like 29ABCDE1234F1Z5',
    'gstin.state': 'GSTIN must start with a valid state code, like 29 for Karnataka',
  });

module.exports = { gstinField };
