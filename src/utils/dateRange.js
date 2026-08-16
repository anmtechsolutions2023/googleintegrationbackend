// src/utils/dateRange.js
// One resolver for every reporting timeframe.
//
// Daily, last-3-days, last-5-days, weekly, weekend-only, monthly and custom are
// not seven different reports — they are one query with different bounds and a
// different GROUP BY. Building them as separate endpoints would multiply the
// same SQL seven times and guarantee they drift apart.
//
// SQL-injection note: `bucketExpression` and `weekendPredicate` return SQL
// fragments that callers interpolate into a query. Both come only from the
// fixed maps below, keyed by values Joi has already restricted to this
// whitelist, so no request text can reach a query. Dates are always bound as
// parameters.

/** Presets, expressed as "how many days back from today does this start". */
const PRESET_DAYS = {
  today: 0,
  yesterday: 1,
  last3: 2,   // today plus the two before it
  last5: 4,
  week: 6,    // a rolling 7 days
  month: 29,  // a rolling 30 days
  weekend: 6, // last week's Saturdays and Sundays
};

const VALID_PRESETS = Object.keys(PRESET_DAYS).concat('custom');

/**
 * Bucket expressions for the trend GROUP BY. `{{COL}}` is replaced with the
 * caller's date column so the same map serves any table.
 */
const BUCKETS = {
  day: 'DATE({{COL}})',
  week: 'YEARWEEK({{COL}}, 3)',      // ISO weeks: Monday start
  month: "DATE_FORMAT({{COL}}, '%Y-%m')",
};

const VALID_BUCKETS = Object.keys(BUCKETS);

const pad = (n) => String(n).padStart(2, '0');

/** YYYY-MM-DD in local time. Never toISOString(), which silently shifts to UTC. */
const toISODate = (date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

const daysAgo = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
};

/**
 * Resolves a reporting window.
 *
 * @param {Object} [query]
 * @param {string} [query.preset] - today | yesterday | last3 | last5 | week | month | weekend | custom
 * @param {string} [query.fromDate] - YYYY-MM-DD, required when preset is 'custom'
 * @param {string} [query.toDate]
 * @param {string} [query.bucket] - day | week | month (default day)
 * @returns {{from:string, to:string, bucket:string, weekendOnly:boolean, preset:string}}
 */
const resolveRange = (query = {}) => {
  const preset = VALID_PRESETS.includes(query.preset) ? query.preset : 'custom';
  const bucket = VALID_BUCKETS.includes(query.bucket) ? query.bucket : 'day';

  if (preset === 'custom') {
    // Custom with nothing supplied is "today" rather than "all history": an
    // unbounded scan is never what a dashboard wants.
    const to = query.toDate || toISODate(new Date());
    const from = query.fromDate || to;
    return { from, to, bucket, weekendOnly: false, preset };
  }

  if (preset === 'yesterday') {
    const day = toISODate(daysAgo(1));
    return { from: day, to: day, bucket, weekendOnly: false, preset };
  }

  return {
    from: toISODate(daysAgo(PRESET_DAYS[preset])),
    to: toISODate(new Date()),
    bucket,
    // 'weekend' is the same window as 'week' with a filter on top, not a
    // separate report.
    weekendOnly: preset === 'weekend',
    preset,
  };
};

/**
 * The GROUP BY expression for a resolved range.
 * @param {string} bucket - Already whitelisted by resolveRange.
 * @param {string} column - A literal column name from the calling query.
 * @returns {string} SQL fragment.
 */
const bucketExpression = (bucket, column) =>
  (BUCKETS[bucket] || BUCKETS.day).replace('{{COL}}', column);

/**
 * Weekend filter, or empty string when the range is not weekend-only.
 *
 * MySQL WEEKDAY() is 0 = Monday … 6 = Sunday, so Saturday and Sunday are 5 and
 * 6. (DAYOFWEEK() uses a different, 1-based Sunday-first numbering — mixing the
 * two is the classic off-by-one here.)
 *
 * @param {boolean} weekendOnly
 * @param {string} column
 * @returns {string} SQL fragment, prefixed with AND, or ''.
 */
const weekendPredicate = (weekendOnly, column) =>
  (weekendOnly ? ` AND WEEKDAY(${column}) IN (5, 6)` : '');

/**
 * Widens a date-only range to cover whole days on a DATETIME column.
 * `BETWEEN '2026-08-01' AND '2026-08-02'` on a DATETIME silently excludes
 * everything after midnight on the last day.
 * @param {{from:string,to:string}} range
 * @returns {{from:string,to:string}}
 */
const toDateTimeBounds = ({ from, to }) => ({
  from: `${from} 00:00:00`,
  to: `${to} 23:59:59`,
});

module.exports = {
  resolveRange,
  bucketExpression,
  weekendPredicate,
  toDateTimeBounds,
  toISODate,
  VALID_PRESETS,
  VALID_BUCKETS,
};
