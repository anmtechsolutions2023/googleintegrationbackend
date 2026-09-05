// src/utils/phoneSchema.js
// One Joi rule for "this field is a mobile number".
//
// Written once because the alternative is four copies that drift. The rule that
// matters is not the regex: it is that validation and storage agree on what a
// number IS. Anything a person might type is accepted, and what comes out the
// other side is the same canonical E.164 string the database keys on — so a
// caller cannot pass validation and then miss every lookup.
//
// See WHATSAPP_IDENTITY_MIGRATION.md §10.1: replacing a field name while
// leaving Joi's .email() in place produces a validator that rejects every real
// input and reports it as an email problem, in a product with no emails left.

const Joi = require('joi');
const { toE164 } = require('./phone');

/**
 * A mobile number, normalised to E.164 as part of validation.
 * `.custom` rather than `.pattern` so the VALUE is canonicalised, not just
 * checked — validation and normalisation must not be two separate passes that
 * can disagree.
 */
const phoneField = () =>
  Joi.string().custom((value, helpers) => {
    const e164 = toE164(value);
    return e164 || helpers.error('any.invalid');
  }, 'mobile number').messages({
    'any.invalid': 'Enter a valid mobile number, for example 98765 43210.',
  });

module.exports = { phoneField };
