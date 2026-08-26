// src/modules/possetting/possetting.schemas.js
// Joi validation schemas for per-branch POS settings.

const Joi = require('joi');
const { TOKEN_NUMBERING, POS_SETTING_KEYS } = require('../../config/constants');

// The branch is the address of every setting, so it is required on both the
// read and the write — there is no tenant-wide row to fall back to.
const branchQuerySchema = Joi.object({
  branchId: Joi.string().uuid().required(),
});

// Keys are enumerated rather than free-form: an unrecognised key would be
// stored happily and then read by nothing, which looks like a setting that
// silently does not work.
const updateSchema = Joi.object({
  [POS_SETTING_KEYS.TOKEN_NUMBERING]: Joi.string()
    .valid(...Object.values(TOKEN_NUMBERING))
    .optional(),
  // Rupees per point. Stored as text like every other setting, but validated as
  // a positive number here — a rate of 0 would divide every sale into infinite
  // points, and a negative one would take points away for buying something.
  [POS_SETTING_KEYS.LOYALTY_RATE]: Joi.number()
    .positive()
    .max(100000)
    .optional(),
}).min(1);

module.exports = { branchQuerySchema, updateSchema };
