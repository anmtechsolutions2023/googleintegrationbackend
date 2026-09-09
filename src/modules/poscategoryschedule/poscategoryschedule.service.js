// src/modules/poscategoryschedule/poscategoryschedule.service.js
// When a menu category is available — the rules behind "Breakfast disappears
// at 11".
//
// NOT a BaseCRUDService. A weekly schedule is edited as a WHOLE: the UI shows
// seven days at once and saves the grid. Row-by-row CRUD would leave the menu
// in half-saved states that a portal could read mid-edit — Tuesday saved,
// Wednesday not — so the only write is a bulk replace inside one transaction.

const { v4: uuidv4 } = require('uuid');
const { QUERIES } = require('../../config/constants');
const { withTransaction, executeQuery } = require('../../utils/dbHelper');
const { HttpError } = require('../../middleware/errorHandler');
const { logger } = require('../../utils/logger');

/** Midnight, as the schema stores it. */
const MIDNIGHT_END = '24:00:00';
const MIDNIGHT_START = '00:00:00';

/** 'HH:MM' or 'HH:MM:SS' → 'HH:MM:SS', so comparisons are on one format. */
const normaliseTime = (t) => (String(t).length === 5 ? `${t}:00` : String(t));

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
  const day = when.getDay();
  const hhmmss = when.toTimeString().slice(0, 8);

  const rows = await executeQuery(QUERIES.POS_CATEGORY_SCHEDULE.COUNT_ACTIVE_NOW, [
    categoryId, tenantId,
    categoryId, tenantId, day, hhmmss, hhmmss,
  ]);

  const { RuleCount = 0, MatchCount = 0 } = rows[0] || {};
  if (Number(RuleCount) === 0) return true;
  return Number(MatchCount) > 0;
};

module.exports = {
  getForCategory,
  getAllForTenant,
  replaceForCategory,
  clearForCategory,
  isAvailableAt,
  // Exported for its unit test — the overnight split is the subtle part.
  splitOvernight,
  normaliseTime,
};
