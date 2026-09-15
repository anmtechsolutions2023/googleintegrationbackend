// src/modules/possetting/possetting.schemas.js
// Joi validation schemas for per-branch POS settings.

const Joi = require('joi');
const { entityId } = require('../../utils/idSchema');
const {
  TOKEN_NUMBERING, POS_SETTING_KEYS, KOT_AUTO_PRINT, KPT, KITCHEN_NOTES,
} = require('../../config/constants');

// The branch is the address of every setting, so it is required on both the
// read and the write — there is no tenant-wide row to fall back to.
const branchQuerySchema = Joi.object({
  branchId: entityId.required(),
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
  [POS_SETTING_KEYS.KOT_AUTO_PRINT]: Joi.string()
    .valid(...Object.values(KOT_AUTO_PRINT))
    .optional(),
  // Fallback Kitchen Preparation Time, in minutes, for portal orders that have
  // no per-dish timings. Bounded by the same range the accept path clamps to,
  // so a branch cannot configure a default the resolver would then override.
  // Zero is refused rather than clamped: as a stored SETTING it is a standing
  // instruction to promise a portal the food is already made.
  [POS_SETTING_KEYS.KPT_DEFAULT_MINUTES]: Joi.number()
    .integer()
    .min(KPT.MIN_MINUTES)
    .max(KPT.MAX_MINUTES)
    .optional(),
  // The quick-pick kitchen notes Billing offers, in the order they are shown.
  // Duplicates are refused ignoring case — two "Less spicy" chips side by side
  // look like a bug. An empty list is allowed: it means "type every note".
  [POS_SETTING_KEYS.KITCHEN_NOTE_PRESETS]: Joi.array()
    .items(Joi.string().trim().min(1).max(KITCHEN_NOTES.PRESET_MAX))
    .max(KITCHEN_NOTES.PRESETS_MAX)
    .unique((a, b) => a.toLowerCase() === b.toLowerCase())
    .optional(),
}).min(1);

module.exports = { branchQuerySchema, updateSchema };
