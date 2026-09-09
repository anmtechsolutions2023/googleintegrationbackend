// src/modules/poscategoryschedule/poscategoryschedule.schemas.js
// Joi validation for category availability windows.

const Joi = require('joi');
const { entityId } = require('../../utils/idSchema');

// 'HH:MM' or 'HH:MM:SS', 00:00:00–24:00:00. 24:00 is admitted deliberately: an
// overnight window is split at midnight, and its first half ENDS at 24:00 —
// which a plain 23:59 ceiling would reject, losing the last minute of the day.
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$|^24:00(?::00)?$/;

const timeField = Joi.string().pattern(TIME_PATTERN).required().messages({
  'string.pattern.base': 'Time must be HH:MM or HH:MM:SS between 00:00 and 24:00.',
});

const ruleSchema = Joi.object({
  // 0 = Sunday … 6 = Saturday, matching JS getDay() so no translation layer
  // sits between the browser and the row.
  DayOfWeek: Joi.number().integer().min(0).max(6).required(),
  StartTime: timeField,
  EndTime: timeField,
});

// An EMPTY array is valid and meaningful: it clears the schedule, returning the
// category to always-available. That is the only route back to the default.
const replaceSchema = Joi.object({
  Rules: Joi.array().items(ruleSchema).max(50).required(),
});

const categoryParamSchema = Joi.object({
  categoryId: entityId.required(),
});

module.exports = { replaceSchema, categoryParamSchema, ruleSchema, TIME_PATTERN };
