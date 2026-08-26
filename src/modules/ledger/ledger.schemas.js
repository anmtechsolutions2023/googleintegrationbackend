// src/modules/ledger/ledger.schemas.js
const Joi = require('joi');
const { VALID_PRESETS, VALID_BUCKETS } = require('../../utils/dateRange');

const listQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).optional().default(1),
  limit: Joi.number().integer().min(1).max(100).optional().default(10),
  status: Joi.string().max(30).optional(),
  fromDate: Joi.date().iso().optional(),
  toDate: Joi.date().iso().optional(),
  contactDetailId: Joi.string().uuid().optional(),
  search: Joi.string().max(100).optional().allow(''),
});

const refundSchema = Joi.object({
  // Recorded on the reversing tender so a refund is never unexplained.
  Reason: Joi.string().max(100).optional().allow(null, ''),
});

/**
 * ONE query contract for every report.
 *
 * Daily, last-3, last-5, weekly, weekend, monthly and custom all arrive through
 * `preset`; they are not separate endpoints. `preset` and `bucket` are
 * restricted to the resolver's whitelist here, which is what makes it safe for
 * the report service to interpolate the bucket expression into SQL.
 */
const reportQuerySchema = Joi.object({
  preset: Joi.string().valid(...VALID_PRESETS).optional().default('today'),
  fromDate: Joi.date().iso().optional(),
  toDate: Joi.date().iso().optional(),
  bucket: Joi.string().valid(...VALID_BUCKETS).optional().default('day'),
  branchId: Joi.string().uuid().optional(),
  categoryId: Joi.string().uuid().optional(),
  itemId: Joi.string().uuid().optional(),
  // Venue bounds, applied to every report that can be sliced by where the money
  // was taken. Deliberately part of the SHARED query contract: "what sold on the
  // rooftop last weekend" is the sales report with two more bounds, not a report
  // of its own — which is what keeps mix-and-match from becoming a combinatorial
  // pile of endpoints.
  floorId: Joi.string().uuid().optional(),
  tableId: Joi.string().uuid().optional(),
  limit: Joi.number().integer().min(1).max(200).optional(),
  // Customer bounds. Same reasoning as the venue bounds above: "when does this
  // regular visit" is the visit-pattern report with one more bound, not a
  // report of its own.
  customerId: Joi.string().uuid().optional(),
  minOrders: Joi.number().integer().min(1).max(1000).optional(),
  // Lapsed only: how long counts as gone.
  days: Joi.number().integer().min(1).max(365).optional(),
})
  // A custom range must actually name its bounds, or it silently collapses to
  // "today" and the caller never learns why their report is empty.
  .when(Joi.object({ preset: Joi.valid('custom').required() }).unknown(), {
    then: Joi.object({
      fromDate: Joi.required(),
      toDate: Joi.required(),
    }),
  })
  // A year is the widest window any single request may scan.
  .custom((value, helpers) => {
    if (value.fromDate && value.toDate) {
      if (new Date(value.toDate) < new Date(value.fromDate)) {
        return helpers.message('toDate must not be earlier than fromDate');
      }
      const days = (new Date(value.toDate) - new Date(value.fromDate)) / 86400000;
      if (days > 366) return helpers.message('Date range must not exceed 366 days');
    }
    return value;
  });

const uuidParamSchema = Joi.object({ id: Joi.string().uuid().required() });

module.exports = { listQuerySchema, refundSchema, reportQuerySchema, uuidParamSchema };
