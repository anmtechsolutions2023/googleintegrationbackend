// src/modules/posoffer/campaign.service.js
//
// A campaign: the container, and the switch.
//
// Offers live inside one. Pausing the campaign pauses every offer in it — one
// control when something goes wrong at 8pm on a Friday, rather than hunting
// down four offers while the till keeps giving chai away.
//
// STATUS IS INTENT, NOT OBSERVED STATE. `Status` stores DRAFT | ACTIVE | PAUSED
// — what a person decided. Whether the campaign is running RIGHT NOW is derived
// from that plus the dates, the weekday, the hour and the budget, because a
// stored "LIVE" flag is a fact with five ways to go stale and every one of them
// ends with an offer that will not fire and nobody able to say why.

const { v4: uuidv4 } = require('uuid');
const { withConnection, withTransaction } = require('../../utils/dbHelper');
const { QUERIES } = require('../../config/constants');
const { logger } = require('../../utils/logger');
const { HttpError } = require('../../middleware/errorHandler');
const MESSAGES = require('../../config/messages');

const STATUS = { DRAFT: 'DRAFT', ACTIVE: 'ACTIVE', PAUSED: 'PAUSED' };

/** What is actually happening, as opposed to what somebody intended. */
const LIVE_STATE = {
  DRAFT: 'DRAFT',
  SCHEDULED: 'SCHEDULED',
  LIVE: 'LIVE',
  // In date range and switched on, but not firing RIGHT NOW — wrong weekday,
  // or outside the hour window. These exist because the alternative was worse:
  // the screen said LIVE while the engine refused every bill, and nothing
  // anywhere could explain the difference.
  OFF_TODAY: 'OFF_TODAY',
  OUTSIDE_HOURS: 'OUTSIDE_HOURS',
  PAUSED: 'PAUSED',
  BUDGET_SPENT: 'BUDGET_SPENT',
  ENDED: 'ENDED',
};

const asDay = (d) => new Date(d).toISOString().slice(0, 10);
/** ISO weekday, 1 = Monday .. 7 = Sunday — the shape DaysOfWeek stores. */
const isoDay = (d) => ((d.getDay() + 6) % 7) + 1;
const asTime = (d) => d.toTimeString().slice(0, 8);
/** MySQL hands TIME back as 'HH:MM:SS'; a form may send 'HH:MM'. */
const normTime = (t) => (t === null || t === undefined || t === '' ? null : String(t).slice(0, 8).padEnd(8, ':00').slice(0, 8));

/**
 * Derive what a campaign is doing now.
 *
 * Order matters: a paused campaign is paused even if its budget is also gone,
 * and an ended one is ended even if it was never switched on. The first true
 * answer is the useful one.
 *
 * @param {Object} row
 * @param {Date} [now]
 * @returns {string}
 */
const liveState = (row, now = new Date()) => {
  if (row.Status === STATUS.DRAFT) return LIVE_STATE.DRAFT;
  if (row.Status === STATUS.PAUSED) return LIVE_STATE.PAUSED;

  const today = asDay(now);
  if (row.EndsOn && asDay(row.EndsOn) < today) return LIVE_STATE.ENDED;
  if (asDay(row.StartsOn) > today) return LIVE_STATE.SCHEDULED;

  // A campaign that has spent its budget did not stop SELLING — it stopped
  // giving away, and it says so rather than silently continuing.
  if (row.BudgetAmount !== null && row.BudgetAmount !== undefined
      && Number(row.SpentAmount || 0) >= Number(row.BudgetAmount)) {
    return LIVE_STATE.BUDGET_SPENT;
  }

  // ── The day and the hour ───────────────────────────────────────────────────
  // These MIRROR the engine's SELECT_ACTIVE exactly. They were missing, so a
  // weekends-only campaign read LIVE on a Tuesday and a 00:05–00:05 window read
  // LIVE all day while firing on no bill at all. A screen that says an offer is
  // running when the till will refuse it is worse than one that says nothing.
  const days = String(row.DaysOfWeek || '').split(',').filter(Boolean);
  if (days.length > 0 && !days.includes(String(isoDay(now)))) return LIVE_STATE.OFF_TODAY;

  const from = normTime(row.StartTime);
  const to = normTime(row.EndTime);
  if (from && to) {
    const at = asTime(now);
    // from > to is a window that crosses midnight — 22:00–02:00 is a real
    // happy hour, not a mistake.
    const inWindow = from <= to ? (at >= from && at <= to) : (at >= from || at <= to);
    if (!inWindow) return LIVE_STATE.OUTSIDE_HOURS;
  }

  return LIVE_STATE.LIVE;
};

const decorate = (row) => ({
  ...row,
  LiveState: liveState(row),
  BudgetRemaining: row.BudgetAmount === null || row.BudgetAmount === undefined
    ? null
    : Math.max(0, Number(row.BudgetAmount) - Number(row.SpentAmount || 0)),
});

const getAll = (tenantId) => withConnection(async (conn) => {
  const [rows] = await conn.execute(QUERIES.POS_CAMPAIGN.SELECT_ALL, [tenantId]);
  return (rows || []).map(decorate);
});

const getById = (id, tenantId) => withConnection(async (conn) => {
  const [rows] = await conn.execute(QUERIES.POS_CAMPAIGN.SELECT_BY_ID, [id, tenantId]);
  if (!rows.length) throw new HttpError('Campaign not found.', MESSAGES.HTTP_STATUS.NOT_FOUND);

  const [branches] = await conn.execute(QUERIES.POS_CAMPAIGN.SELECT_BRANCHES, [id, tenantId]);
  const [offers] = await conn.execute(QUERIES.POS_OFFER.SELECT_BY_CAMPAIGN, [id, tenantId]);
  return {
    ...decorate(rows[0]),
    // No rows means EVERY branch — the common case, stored as nothing rather
    // than a row per branch somebody has to maintain as outlets open.
    branchIds: (branches || []).map((b) => b.BranchDetailId),
    offers: offers || [],
  };
});

const writeBranchesTx = async (conn, campaignId, branchIds, tenantId, userEmail) => {
  await conn.execute(QUERIES.POS_CAMPAIGN.DELETE_BRANCHES, [campaignId, tenantId]);
  for (const branchId of branchIds || []) {
    // eslint-disable-next-line no-await-in-loop
    await conn.execute(QUERIES.POS_CAMPAIGN.INSERT_BRANCH, [
      uuidv4(), tenantId, campaignId, branchId, userEmail, userEmail,
    ]);
  }
};

/**
 * A time window has to be capable of containing a moment.
 *
 * StartTime === EndTime is a window of zero length: the campaign shows as
 * scheduled and fires on nothing. Silently reinterpreting it as "all day" would
 * be guessing at intent; refusing it names the mistake while somebody is still
 * looking at the form.
 *
 * @param {Object} data
 */
const assertWindow = (data) => {
  const from = data.StartTime ? String(data.StartTime).slice(0, 5) : null;
  const to = data.EndTime ? String(data.EndTime).slice(0, 5) : null;
  if (from && to && from === to) {
    throw new HttpError(
      'A start and end time that are the same is a window of zero length — '
      + 'the campaign would never run. Leave both blank for all day.',
      MESSAGES.HTTP_STATUS.BAD_REQUEST,
    );
  }
  // One without the other is ambiguous in the same way.
  if ((from && !to) || (!from && to)) {
    throw new HttpError(
      'Give both a start and an end time, or neither for all day.',
      MESSAGES.HTTP_STATUS.BAD_REQUEST,
    );
  }
};

const create = (data, tenantId, userEmail) => withTransaction(async (conn) => {
  assertWindow(data);
  const id = uuidv4();
  await conn.execute(QUERIES.POS_CAMPAIGN.INSERT, [
    id, tenantId, data.Name, data.Code, data.Description || null,
    data.StartsOn, data.EndsOn || null, data.DaysOfWeek || null,
    data.StartTime || null, data.EndTime || null,
    data.BudgetAmount ?? null, data.Status || STATUS.DRAFT,
    userEmail, userEmail,
  ]);
  await writeBranchesTx(conn, id, data.branchIds, tenantId, userEmail);
  logger.info('Campaign created', { tenantId, campaignId: id, name: data.Name, userEmail });
  return { id };
});

const update = (id, data, tenantId, userEmail) => withTransaction(async (conn) => {
  const [rows] = await conn.execute(QUERIES.POS_CAMPAIGN.SELECT_BY_ID, [id, tenantId]);
  if (!rows.length) throw new HttpError('Campaign not found.', MESSAGES.HTTP_STATUS.NOT_FOUND);
  const existing = rows[0];
  // Validate the MERGED shape: sending only StartTime must be judged against
  // the EndTime already stored, not against nothing.
  assertWindow({
    StartTime: data.StartTime !== undefined ? data.StartTime : existing.StartTime,
    EndTime: data.EndTime !== undefined ? data.EndTime : existing.EndTime,
  });

  await conn.execute(QUERIES.POS_CAMPAIGN.UPDATE, [
    data.Name ?? existing.Name,
    data.Description !== undefined ? data.Description : existing.Description,
    data.StartsOn ?? existing.StartsOn,
    data.EndsOn !== undefined ? data.EndsOn : existing.EndsOn,
    data.DaysOfWeek !== undefined ? data.DaysOfWeek : existing.DaysOfWeek,
    data.StartTime !== undefined ? data.StartTime : existing.StartTime,
    data.EndTime !== undefined ? data.EndTime : existing.EndTime,
    data.BudgetAmount !== undefined ? data.BudgetAmount : existing.BudgetAmount,
    data.Status ?? existing.Status,
    userEmail, id, tenantId,
  ]);
  if (data.branchIds !== undefined) {
    await writeBranchesTx(conn, id, data.branchIds, tenantId, userEmail);
  }
  return { id };
});

/**
 * Pause or resume. Its own call, and audited louder than an edit: this is the
 * switch somebody reaches for when a promotion is going wrong, and knowing who
 * flipped it matters more than knowing who renamed it.
 */
const setStatus = (id, status, tenantId, userEmail) => withConnection(async (conn) => {
  if (!Object.values(STATUS).includes(status)) {
    throw new HttpError(
      `Status must be one of: ${Object.values(STATUS).join(', ')}.`,
      MESSAGES.HTTP_STATUS.BAD_REQUEST,
    );
  }
  const [res] = await conn.execute(QUERIES.POS_CAMPAIGN.SET_STATUS, [status, userEmail, id, tenantId]);
  if (!res.affectedRows) throw new HttpError('Campaign not found.', MESSAGES.HTTP_STATUS.NOT_FOUND);
  logger.warn('Campaign status changed', { tenantId, campaignId: id, status, userEmail });
  return { id, Status: status };
});

/**
 * Soft delete only.
 *
 * A campaign that gave money away is a historical fact. Removing the row would
 * orphan every redemption written against it and make last month's cost
 * unanswerable.
 */
const remove = (id, tenantId, userEmail) => withConnection(async (conn) => {
  const [res] = await conn.execute(QUERIES.POS_CAMPAIGN.SOFT_DELETE, [userEmail, id, tenantId]);
  if (!res.affectedRows) throw new HttpError('Campaign not found.', MESSAGES.HTTP_STATUS.NOT_FOUND);
  return { id };
});

module.exports = {
  getAll, getById, create, update, setStatus, remove,
  liveState, assertWindow, STATUS, LIVE_STATE,
};
