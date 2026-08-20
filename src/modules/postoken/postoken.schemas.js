// src/modules/postoken/postoken.schemas.js
// Joi validation schemas for POS Token operations.

const Joi = require('joi');
const { POS_TOKEN_STATUSES } = require('../../config/constants');
const { VALID_PRESETS } = require('../../utils/dateRange');

// Canonical lowercase enum, normalized on write. Status was free text, so
// 'Waiting' and 'waiting' could both be stored and every reader had to guess.
const statusField = Joi.string().lowercase().valid(...POS_TOKEN_STATUSES);

// TokenNumber and TokenLabel are NOT accepted from the client — they are minted
// server-side from the branch's numbering mode. The browser used to compute
// Math.max(...) + 1 over whatever it had loaded, which collided the moment two
// tills issued at once. Anything sent is ignored.
const createSchema = Joi.object({
  // Required: a token belongs to exactly one counter queue, and the queue is
  // what the number is unique within.
  BranchDetailId: Joi.string().uuid().required(),
  OrderId: Joi.string().uuid().optional().allow(null),
  Active: Joi.boolean().optional().default(true),
});

const updateSchema = Joi.object({
  OrderId: Joi.string().uuid().optional().allow(null),
  Status: statusField.optional().allow(null, ''),
  BranchDetailId: Joi.string().uuid().optional(),
  Active: Joi.boolean().optional(),
}).min(1);

// Filters are optional; omitting them yields the original unfiltered list.
const paginationSchema = Joi.object({
  page: Joi.number().integer().min(1).optional().default(1),
  limit: Joi.number().integer().min(1).max(100).optional().default(10),
  // One branch's queue — the customer display and the counter both show one
  // queue, never the tenant's tokens pooled together.
  branchId: Joi.string().uuid().optional(),
  // A single day, YYYY-MM-DD. Matched with a pattern rather than .isoDate()
  // because Joi normalizes an isoDate to a full timestamp, which would never
  // equal a DATE column.
  date: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).optional(),
  status: statusField.optional(),
});

const uuidParamSchema = Joi.object({
  id: Joi.string().uuid().required(),
});

// Queue statistics share the ledger reports' timeframe vocabulary rather than
// inventing a second one — the Finance screen sends one range to both sides,
// and two resolvers would eventually disagree about what "last weekend" means.
const statsQuerySchema = Joi.object({
  preset: Joi.string().valid(...VALID_PRESETS).optional().default('today'),
  fromDate: Joi.date().iso().optional(),
  toDate: Joi.date().iso().optional(),
  branchId: Joi.string().uuid().optional(),
  // Accepted and ignored: the Finance screen sends one query object to every
  // report, and rejecting the keys this one does not use would make the caller
  // special-case it.
  bucket: Joi.string().optional(),
  floorId: Joi.string().uuid().optional(),
  tableId: Joi.string().uuid().optional(),
  categoryId: Joi.string().uuid().optional(),
  itemId: Joi.string().uuid().optional(),
  limit: Joi.number().integer().min(1).max(200).optional(),
}).when(Joi.object({ preset: Joi.valid('custom').required() }).unknown(), {
  then: Joi.object({ fromDate: Joi.required(), toDate: Joi.required() }),
});

module.exports = {
  createSchema, updateSchema, paginationSchema, uuidParamSchema, statsQuerySchema,
};
