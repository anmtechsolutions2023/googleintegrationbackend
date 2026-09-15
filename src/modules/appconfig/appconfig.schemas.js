// src/modules/appconfig/appconfig.schemas.js
// Joi validation for the Application Configuration endpoints.

const Joi = require('joi');

/**
 * An IANA zone name this Node build actually knows.
 *
 * Checked against Intl rather than a pattern: 'Asia/Kolkatta' looks perfectly
 * well-formed and is not a zone, and a typo here silently moves every category
 * schedule in the platform onto the wrong clock — the service would fall back
 * to the default and log, which nobody reads. Refusing it at the boundary is
 * the only point where a person is still looking at the screen.
 */
const ianaTimeZone = Joi.string().max(64).custom((value, helpers) => {
  try {
    // eslint-disable-next-line no-new
    new Intl.DateTimeFormat('en-GB', { timeZone: value });
    return value;
  } catch {
    return helpers.error('any.invalid');
  }
}).messages({
  'any.invalid': '"timezone" must be an IANA zone name, e.g. Asia/Kolkata.',
});

// PATCH body — at least one setting must be present.
const updateConfigSchema = Joi.object({
  autoApproveOnboarding: Joi.boolean(),
  // The clock every category schedule is read against. Platform-wide:
  // app_settings has no tenant_id.
  timezone: ianaTimeZone,
}).min(1);

module.exports = { updateConfigSchema };
