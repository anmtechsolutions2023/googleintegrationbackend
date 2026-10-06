// src/modules/export/export.schemas.js
// The query every export takes, plus each export's own filters.
//
// Validated per export rather than once at the route: `status` is a ledger
// status on one file and an expense status on another, and one schema for all
// of them would have to accept every value any of them knows.

const Joi = require('joi');
const { entityId } = require('../../utils/idSchema');
const { VALID_PRESETS, VALID_BUCKETS } = require('../../utils/dateRange');

const KEY_PATTERN = /^[a-z][a-z-]{1,40}$/;

const baseQuery = Joi.object({
  preset: Joi.string().valid(...VALID_PRESETS).default('month'),
  fromDate: Joi.date().iso(),
  toDate: Joi.date().iso().min(Joi.ref('fromDate')),
  branchId: entityId,
  bucket: Joi.string().valid(...VALID_BUCKETS).default('day'),
  // Comma-separated column group keys; omitted = the export's defaults.
  groups: Joi.string().trim().max(200).allow(''),
  // Only honoured for CUSTOMER:EXPORT holders and admins (export.catalogue).
  unmask: Joi.boolean().default(false),
})
  // A custom range has to name both ends, or it silently becomes "today".
  .when(Joi.object({ preset: Joi.valid('custom').required() }).unknown(), {
    then: Joi.object({ fromDate: Joi.required(), toDate: Joi.required() }),
  });

/**
 * The schema for one export: the base plus its own filters.
 *
 * Only extended when there ARE filters: Joi reads `.keys({})` as "no keys
 * allowed", and with stripUnknown that silently dropped the period, branch and
 * every other option from each export that has no filters of its own.
 */
const queryFor = (def) => (def.filters && Object.keys(def.filters).length ? baseQuery.keys(def.filters) : baseQuery);

const keyParam = Joi.string().pattern(KEY_PATTERN).required();

module.exports = { baseQuery, queryFor, keyParam };
