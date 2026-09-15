// src/modules/taxsetting/taxsetting.schemas.js
const Joi = require('joi');
const { gstinField } = require('../../utils/gstinSchema');

// Off needs a reason, because the reason decides what the bill prints. On must
// not carry one — a stale 'composition' sitting beside "charging" is how a
// receipt ends up printing a declaration on a tax invoice.
const updateSchema = Joi.object({
  gstCharging: Joi.boolean().required(),
  offReason: Joi.when('gstCharging', {
    is: false,
    then: Joi.string().valid('composition', 'unregistered').required(),
    otherwise: Joi.valid(null).optional(),
  }),
});

// A branch's GSTIN. Required as a KEY so an empty body is not read as "clear
// it"; blank or null as a VALUE is how it is cleared on purpose.
const branchGstinSchema = Joi.object({
  gstin: gstinField.required(),
});

module.exports = { updateSchema, branchGstinSchema };
