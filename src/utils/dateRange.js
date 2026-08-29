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

/**
 * The calendar date a business document belongs to.
 *
 * The one authority for "which day is this?", used by whatever WRITES a date
 * and by whatever READS a range. Documents were previously stamped with
 * `toISOString().slice(0, 10)` — the date in UTC — while every report resolves
 * a range from toISODate below, which reads the LOCAL calendar. In UTC+5:30
 * that filed every sale taken between midnight and 05:30 under the previous
 * day: the till said today, Finance said yesterday, and neither was lying
 * about its own clock.
 *
 * @param {Date|string} [when] - Defaults to now.
 * @returns {string} YYYY-MM-DD, local calendar.
 */
const businessDate = (when) => toISODate(when ? new Date(when) : new Date());

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
/**
 * Minutes to add to a UTC DATETIME to read it as local wall-clock time.
 * Computed from the app's own offset, so it tracks the machine the reports run
 * on — the same clock resolveRange() built the day from.
 */
const localOffsetMinutes = () => -new Date().getTimezoneOffset();

/**
 * ` AND WEEKDAY(...) IN (5, 6)` — Saturday and Sunday.
 *
 * `utc: true` for a column the pool wrote in UTC (see toDateTimeBounds). A
 * Saturday 11pm sale in IST is a SUNDAY instant in UTC, so asking WEEKDAY() of
 * the raw column moves late trade onto the wrong day of the week — the same
 * frame mistake as pasting midnight onto a local date. The interval is a number
 * this module computes, never user input, so interpolating it is safe.
 *
 * @param {boolean} weekendOnly
 * @param {string} column
 * @param {{utc?: boolean}} [opts]
 */
const weekendPredicate = (weekendOnly, column, { utc = false } = {}) => {
  if (!weekendOnly) return '';
  const expr = utc ? `${column} + INTERVAL ${localOffsetMinutes()} MINUTE` : column;
  return ` AND WEEKDAY(${expr}) IN (5, 6)`;
};

/** 'YYYY-MM-DD HH:MM:SS' in UTC — the frame the pool writes DATETIMEs in. */
const asUtcStamp = (date) => date.toISOString().slice(0, 19).replace('T', ' ');

/** The instant a local calendar day starts, or the last second it ends. */
const localEdge = (isoDate, endOfDay) => {
  const [y, m, d] = String(isoDate).split('-').map(Number);
  return endOfDay
    ? new Date(y, m - 1, d, 23, 59, 59)
    : new Date(y, m - 1, d, 0, 0, 0);
};

/**
 * Widens a date-only range to cover whole days on a DATETIME column, IN THE
 * FRAME THAT COLUMN IS STORED IN.
 *
 * Two things are true at once here, and both are correct:
 *   - a business day is LOCAL. "Today's takings" means the restaurant's today,
 *     which is why TransactionDate is written as the local calendar date.
 *   - a DATETIME is an INSTANT, and the pool is pinned to UTC (config/db.js
 *     sets timezone: 'Z'), so every Timestamp lands in UTC.
 *
 * Pasting ` 00:00:00` onto a local date and comparing it to a UTC column
 * silently compares two different clocks. East of Greenwich the offset eats the
 * end of the day: at IST (+5:30) a sale rung up at 20:00 local is stored as
 * 14:30 UTC — but one rung at 20:00 on the 27th is stored on the 27th while its
 * own invoice is dated the 28th. The Z-report and the sales report then land on
 * DIFFERENT DAYS for the whole of dinner service, and never reconcile.
 *
 * So the local day is converted to the UTC instants that bracket it.
 *
 * @param {{from:string,to:string}} range
 * @returns {{from:string,to:string}}
 */
const toDateTimeBounds = ({ from, to }) => ({
  from: asUtcStamp(localEdge(from, false)),
  to: asUtcStamp(localEdge(to, true)),
});

module.exports = {
  resolveRange,
  localOffsetMinutes,
  bucketExpression,
  weekendPredicate,
  toDateTimeBounds,
  toISODate,
  businessDate,
  VALID_PRESETS,
  VALID_BUCKETS,
};
