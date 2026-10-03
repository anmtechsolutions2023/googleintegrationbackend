// src/modules/posdailystock/posdailystock.schemas.js

const Joi = require('joi');
const { entityId } = require('../../utils/idSchema');

/** YYYY-MM-DD, the shape utils/dateRange.businessDate() emits. */
const businessDate = Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).messages({
  'string.pattern.base': 'Date must be YYYY-MM-DD.',
});

/** Reads are per outlet per day; the day defaults to today on the server. */
const dayQuerySchema = Joi.object({
  branchId: entityId.required(),
  date: businessDate.optional(),
});

/**
 * Setting the count.
 *
 * Zero is legal and means something precise — "we made none today" — which is a
 * different statement from clearing the row ("nobody has said"). Both end with
 * the dish unsellable; only one of them was a decision.
 */
const setSchema = Joi.object({
  itemMetaId: entityId.required(),
  preparedQty: Joi.number().integer().min(0).max(100000).required(),
  date: businessDate.optional(),
});

const clearQuerySchema = Joi.object({
  branchId: entityId.required(),
  date: businessDate.optional(),
});

const itemParamSchema = Joi.object({
  itemMetaId: entityId.required(),
});

module.exports = { dayQuerySchema, setSchema, clearQuerySchema, itemParamSchema };
