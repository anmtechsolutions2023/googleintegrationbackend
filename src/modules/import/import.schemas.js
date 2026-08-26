// src/modules/import/import.schemas.js
//
// A row that fails validation never reaches the database, and the message says
// what to fix — an import that reports "row 37 failed" without saying why sends
// somebody back to a spreadsheet to guess.

const Joi = require('joi');
const { IMPORT } = require('../../config/constants');

const trimmed = (max) => Joi.string().trim().max(max);

// One catalogue item. Names are matched against itemdetail.Name, which is
// UNIQUE per tenancy — that is what decides skip-vs-update on a re-run.
const itemRowSchema = Joi.object({
  name: trimmed(200).required().messages({
    'any.required': 'name is required',
    'string.empty': 'name cannot be blank',
  }),
  category: trimmed(50).required().messages({
    'any.required': 'category is required',
  }),
  unit: trimmed(50).required().messages({
    'any.required': 'unit is required',
  }),
  // Rejects '1O9' — a letter O for a zero, the way a real spreadsheet fails.
  price: Joi.number().min(0).required().messages({
    'number.base': 'price must be a number',
    'number.min': 'price cannot be negative',
  }),
  taxGroup: trimmed(50).required().messages({
    'any.required': 'tax_group is required',
  }),
  // Defaults true: a board price is what the customer hands over.
  taxIncluded: Joi.boolean().default(true),
  code: trimmed(50).allow('', null),
  description: trimmed(1000).allow('', null),
  // Only the publish pass uses this; carried here so one file drives both.
  foodType: trimmed(50).allow('', null),
  // The rates that make a tax group mean something. Stated rather than inferred
  // from the group's NAME: splitting 5% into CGST and SGST is an Indian
  // intra-state rule, not arithmetic, and a group called "Standard" carries no
  // rate at all. When a row omits these, IMPORT.DEFAULT_TAX_COMPONENTS applies.
  taxComponents: Joi.array().max(6).items(Joi.object({
    name: trimmed(50).required(),
    value: Joi.number().min(0).max(100).required().messages({
      'number.base': 'a tax rate must be a number',
    }),
  })).default([]),
});

const importItemsSchema = Joi.object({
  onDuplicate: Joi.string()
    .valid(IMPORT.ON_DUPLICATE.SKIP, IMPORT.ON_DUPLICATE.UPDATE)
    .default(IMPORT.ON_DUPLICATE.SKIP),
  rows: Joi.array().items(itemRowSchema).min(1).max(IMPORT.MAX_ROWS).required()
    .messages({
      'array.max': `An import is limited to ${IMPORT.MAX_ROWS} rows`,
      'array.min': 'The file has no rows',
    }),
});

// Publishing to a branch. Takes item NAMES rather than ids so the same file
// drives this pass without a lookup step in the browser.
const importMenuSchema = Joi.object({
  branchDetailId: Joi.string().uuid().required(),
  defaultFoodType: trimmed(50).default('VEG'),
  channelIds: Joi.array().items(Joi.string().uuid()).default([]),
  variantIds: Joi.array().items(Joi.string().uuid()).default([]),
  items: Joi.array().items(Joi.object({
    name: trimmed(200).required(),
    foodType: trimmed(50).allow('', null),
  })).min(1).max(IMPORT.MAX_ROWS).required(),
});

// Read-only: what WOULD happen. Used by the preview to warn about a tax group
// with no tax types before anything is written.
const previewSchema = Joi.object({
  taxGroups: Joi.array().items(trimmed(50)).min(1).max(50).required(),
});

module.exports = { importItemsSchema, importMenuSchema, previewSchema, itemRowSchema };
