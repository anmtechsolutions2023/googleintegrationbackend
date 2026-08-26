// src/modules/loyalty/loyalty.schemas.js
// Joi validation for the loyalty endpoints.

const Joi = require('joi');

const uuidParamSchema = Joi.object({ id: Joi.string().uuid().required() });

// A manual movement of points. Signed on purpose: the same gesture covers a
// goodwill grant and a correction, and forcing a separate "deduct" verb would
// only invite the sign to be dropped somewhere in between.
//
// Zero is refused because it writes an entry that means nothing, and a reason
// is required because an unexplained adjustment is exactly the entry an
// auditor asks about six months later.
const adjustSchema = Joi.object({
  Points: Joi.number().integer().min(-100000).max(100000).invalid(0).required(),
  Reason: Joi.string().max(255).required().trim(),
});

module.exports = { uuidParamSchema, adjustSchema };
