// src/modules/poscategoryschedule/poscategoryschedule.service.js
// When a menu category is available — the rules behind "Breakfast disappears
// at 11".
//
// NOT a BaseCRUDService. A weekly schedule is edited as a WHOLE: the UI shows
// seven days at once and saves the grid. Row-by-row CRUD would leave the menu
// in half-saved states that a portal could read mid-edit — Tuesday saved,
// Wednesday not — so the only write is a bulk replace inside one transaction.

const { v4: uuidv4 } = require('uuid');
const { QUERIES, CLOCK } = require('../../config/constants');
const { withTransaction, executeQuery } = require('../../utils/dbHelper');
const { HttpError } = require('../../middleware/errorHandler');
const { logger } = require('../../utils/logger');
const appConfig = require('../appconfig/appconfig.service');


/** Midnight, as the schema stores it. */
const MIDNIGHT_END = '24:00:00';
const MIDNIGHT_START = '00:00:00';

/** 'HH:MM' or 'HH:MM:SS' → 'HH:MM:SS', so comparisons are on one format. */
const normaliseTime = (t) => (String(t).length === 5 ? `${t}:00` : String(t));

/** Does this Node build know the zone? Intl throws RangeError when it does not. */
const isKnownZone = (tz) => {
  if (!tz) return false;
  try {
    // eslint-disable-next-line no-new
    new Intl.DateTimeFormat('en-GB', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

const WEEKDAY = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/**
 * The weekday and wall-clock time at `when`, IN A GIVEN ZONE.
 *
 * Both halves have to come from the same conversion. Taking the day from the
 * server and the time from the zone is how a Friday-night window silently
 * becomes a Saturday one either side of midnight.
 *
 * hourCycle h23 is deliberate: with hour12 false some locales render midnight
 * as 24, which sorts after every stored StartTime and matches nothing.
 *
 * @param {Date} when
 * @param {string} [timeZone] IANA name; the server's own clock when omitted.
 * @returns {{day: number, time: string}} day 0=Sunday, time 'HH:MM:SS'
 */
const clockIn = (when, timeZone) => {
  if (!timeZone) {
    return { day: when.getDay(), time: when.toTimeString().slice(0, 8) };
  }
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(when).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});

  return {
    day: WEEKDAY[parts.weekday],
    time: `${parts.hour}:${parts.minute}:${parts.second}`,
  };
};

// The zone changes about never, and a menu read would otherwise pay a
// single-row lookup for it every time. Per process, so a change takes up to the
// TTL to reach a warm instance — acceptable for a value nobody edits twice.
const TZ_TTL_MS = 5 * 60 * 1000;
let tzCache = { value: null, at: 0 };

/**
 * The platform's trading-day zone, validated.
 *
 * Falls back to the seeded default rather than throwing: a menu that renders on
 * the wrong clock is a bug, a menu that 500s is an outage.
 * @returns {Promise<string>}
 */
const getTimeZone = async () => {
  const now = Date.now();
  if (tzCache.value && now - tzCache.at < TZ_TTL_MS) return tzCache.value;

  let tz = null;
  try {
    tz = await appConfig.getSetting(CLOCK.SETTING_TIMEZONE);
  } catch (err) {
    logger.warn('Could not read the trading-day timezone — using the default', {
      error: err.message, fallback: CLOCK.DEFAULT_TIMEZONE,
    });
  }
  if (!isKnownZone(tz)) {
    if (tz) {
      logger.warn('Unknown timezone in app_settings — using the default', {
        configured: tz, fallback: CLOCK.DEFAULT_TIMEZONE,
      });
    }
    tz = CLOCK.DEFAULT_TIMEZONE;
  }
  tzCache = { value: tz, at: now };
  return tz;
};

/** Drops the memo, so a change made through Application Configuration lands. */
const forgetTimeZone = () => { tzCache = { value: null, at: 0 }; };

/**
 * Splits a window that crosses midnight into two same-day rows.
 *
 * A rule like Fri 22:00–02:00 cannot be stored as one row: every query compares
 * `StartTime <= now AND EndTime > now`, and with EndTime BEFORE StartTime that
 * test matches nothing — the category would silently never be available, which
 * is the worst kind of failure because the data looks right.
 *
 * So it becomes Fri 22:00–24:00 plus Sat 00:00–02:00, which is what the rule
 * actually means, and every comparison downstream stays a simple between.
 *
 * @param {{DayOfWeek:number, StartTime:string, EndTime:string}} rule
 * @returns {Array<{DayOfWeek:number, StartTime:string, EndTime:string}>}
 */
const splitOvernight = (rule) => {
  const start = normaliseTime(rule.StartTime);
  const end = normaliseTime(rule.EndTime);
  const day = Number(rule.DayOfWeek);

  if (start < end) return [{ DayOfWeek: day, StartTime: start, EndTime: end }];

  // Equal start and end is not "all day", it is a zero-length window somebody
  // typed by mistake. Refusing beats silently storing a rule that never fires.
  if (start === end) {
    throw new HttpError(
      `A schedule window cannot start and end at the same time (${start}).`,
      400,
    );
  }

  return [
    { DayOfWeek: day, StartTime: start, EndTime: MIDNIGHT_END },
    // Sunday(0) wraps back round from Saturday(6).
    { DayOfWeek: (day + 1) % 7, StartTime: MIDNIGHT_START, EndTime: end },
  ];
};

/**
 * The rules for one category, as stored.
 * @param {string} categoryId
 * @param {string} tenantId
 */
const getForCategory = async (categoryId, tenantId) =>
  executeQuery(QUERIES.POS_CATEGORY_SCHEDULE.SELECT_BY_CATEGORY, [categoryId, tenantId]);

/** Every rule in the tenancy, for a menu push. */
const getAllForTenant = async (tenantId) =>
  executeQuery(QUERIES.POS_CATEGORY_SCHEDULE.SELECT_ALL_FOR_TENANT, [tenantId]);

/**
 * Replace a category's whole schedule.
 *
 * An EMPTY array is meaningful and allowed: it clears every rule, which returns
 * the category to always-available. That is the documented default and the only
 * way back to it.
 *
 * @param {string} categoryId
 * @param {Array} rules
 * @param {string} tenantId
 * @param {string} userPhone
 */
const replaceForCategory = async (categoryId, rules, tenantId, userPhone) => {
  const expanded = (rules || []).flatMap(splitOvernight);

  return withTransaction(async (connection) => {
    // The category must exist in THIS tenancy. Without the check a schedule
    // could be hung off another tenant's id, or off nothing at all — the FK
    // would catch the second but reports it as a 500.
    const [catRows] = await connection.execute(
      QUERIES.CATEGORY.SELECT_BY_ID,
      [categoryId, tenantId],
    );
    if (!catRows || catRows.length === 0) {
      throw new HttpError('Category not found.', 404);
    }

    await connection.execute(
      QUERIES.POS_CATEGORY_SCHEDULE.DELETE_BY_CATEGORY,
      [categoryId, tenantId],
    );

    for (const rule of expanded) {
      await connection.execute(QUERIES.POS_CATEGORY_SCHEDULE.INSERT, [
        uuidv4(), categoryId, rule.DayOfWeek, rule.StartTime, rule.EndTime,
        tenantId, userPhone, userPhone,
      ]);
    }

    logger.info('Category schedule replaced', {
      categoryId, tenantId, submitted: (rules || []).length, stored: expanded.length,
    });

    const [rows] = await connection.execute(
      QUERIES.POS_CATEGORY_SCHEDULE.SELECT_BY_CATEGORY,
      [categoryId, tenantId],
    );
    return rows;
  });
};

/** Clear every rule — the category becomes always available. */
const clearForCategory = async (categoryId, tenantId, userPhone) =>
  replaceForCategory(categoryId, [], tenantId, userPhone);

/**
 * Is a category on the menu at `when`, and if not, when does it reopen?
 *
 * THE ONLY IMPLEMENTATION OF THE RULE. It was briefly written a second time in
 * SQL so the menu query could carry availability without a second read, and the
 * two disagreed immediately: MySQL runs on the DATABASE server's clock (UTC on
 * both the local container and Aiven), while this file compares against the APP
 * server's. Locally that is a five-and-a-half hour gap, so a breakfast window
 * read one way was closed and read the other way was open. One rule, one clock.
 *
 * WHOSE clock it should be is a separate and still-open question: `when`
 * defaults to the app server's local time, which is IST in development and UTC
 * on Vercel — neither of which is reliably the outlet's. Callers pass an
 * explicit `when` so that decision has one place to land.
 *
 * NO RULES MEANS AVAILABLE. That default is load-bearing: the alternative is
 * that introducing this table silently removes every category from every menu.
 *
 * @param {Array<{DayOfWeek:number, StartTime:string, EndTime:string}>} rules
 *        the rules for ONE category
 * @param {Date} [when]
 * @returns {{available: boolean, opensAt: string|null}}
 */
const availabilityOf = (rules, when = new Date(), timeZone = null) => {
  if (!Array.isArray(rules) || rules.length === 0) return { available: true, opensAt: null };

  const { day, time: nowT } = clockIn(when, timeZone);

  const open = rules.some((r) => Number(r.DayOfWeek) === day
    && normaliseTime(r.StartTime) <= nowT
    && normaliseTime(r.EndTime) > nowT);
  if (open) return { available: true, opensAt: null };

  // The next start still to come today; failing that, the earliest it ever
  // opens. An approximation on purpose — naming the exact next weekday costs a
  // calendar walk for a string that only ever labels a chip on a card.
  const laterToday = rules
    .filter((r) => Number(r.DayOfWeek) === day && normaliseTime(r.StartTime) > nowT)
    .map((r) => normaliseTime(r.StartTime))
    .sort();
  const everyStart = rules.map((r) => normaliseTime(r.StartTime)).sort();

  return { available: false, opensAt: laterToday[0] || everyStart[0] || null };
};

/**
 * Every rule in the tenancy, grouped by the category it governs.
 *
 * One read for a whole menu rather than one per dish — the shape
 * SELECT_ALL_FOR_TENANT was written for.
 *
 * @param {Array<Object>} rows
 * @returns {Map<string, Array<Object>>}
 */
const indexByCategory = (rows) => {
  const byCategory = new Map();
  (rows || []).forEach((r) => {
    if (!byCategory.has(r.CategoryId)) byCategory.set(r.CategoryId, []);
    byCategory.get(r.CategoryId).push(r);
  });
  return byCategory;
};

/**
 * Is this category on the menu at `when`?
 *
 * THE DEFAULT IS AVAILABLE. A category with no rules is always on, and that
 * must stay true: the alternative is that introducing this table silently
 * removes every existing category from every menu.
 *
 * @param {string} categoryId
 * @param {string} tenantId
 * @param {Date} when defaults to now
 * @returns {Promise<boolean>}
 */
const isAvailableAt = async (categoryId, tenantId, when = new Date()) => {
  const [rules, timeZone] = await Promise.all([
    executeQuery(QUERIES.POS_CATEGORY_SCHEDULE.SELECT_BY_CATEGORY, [categoryId, tenantId]),
    getTimeZone(),
  ]);
  return availabilityOf(rules.filter((r) => r.Active !== 0), when, timeZone).available;
};

module.exports = {
  getForCategory,
  getAllForTenant,
  replaceForCategory,
  clearForCategory,
  isAvailableAt,
  // The rule itself, and the shape a whole menu needs it in.
  availabilityOf,
  indexByCategory,
  getTimeZone,
  forgetTimeZone,
  // exported for its unit test — the zone conversion is the subtle part
  clockIn,
  // Exported for its unit test — the overnight split is the subtle part.
  splitOvernight,
  normaliseTime,
};
