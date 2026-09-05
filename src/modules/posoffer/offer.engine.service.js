// src/modules/posoffer/offer.engine.service.js
//
// The bridge between the database and the pure evaluator.
//
// WHAT LIVES WHERE, AND WHY IT MATTERS
//   offer.evaluator   decides WHAT to discount. Pure — no db, no clock, no HTTP.
//   this file         fetches what the evaluator needs, and writes what it did.
//   posbill           decides how the money works, exactly as it already did.
//
// The till previews with `preview()` and the settle path enforces with
// `resolveForBillTx()`. Both funnel into the SAME evaluator, so the offers a
// cashier is shown and the discounts a customer is actually given cannot
// disagree — which is the one failure mode that destroys trust in a promotion.

const { v4: uuidv4 } = require('uuid');
const { withConnection } = require('../../utils/dbHelper');
const { QUERIES } = require('../../config/constants');
const { logger } = require('../../utils/logger');
const evaluator = require('./offer.evaluator');

/** ISO weekday, 1 = Monday .. 7 = Sunday — the shape DaysOfWeek stores. */
const isoDay = (date) => ((date.getDay() + 6) % 7) + 1;

const asDate = (date) => date.toISOString().slice(0, 10);
const asTime = (date) => date.toTimeString().slice(0, 8);

/**
 * Every offer that could fire on this bill, right now.
 *
 * "Is it running" is ONE query rather than a status column somebody has to keep
 * true: inside its dates, on the right weekday, within its hours, under its
 * budget, at this branch. A stored "LIVE" flag is a fact with five ways to go
 * stale, and every one of them ends with an offer that will not apply and
 * nobody able to say why.
 *
 * @param {Object} conn - Open connection or transaction.
 * @param {Object} args - { branchId, at }
 * @param {string} tenantId
 * @returns {Promise<Array<Object>>}
 */
const activeOffersTx = async (conn, { branchId, at = new Date() }, tenantId) => {
  const day = String(isoDay(at));
  const date = asDate(at);
  const time = asTime(at);
  const [rows] = await conn.execute(QUERIES.POS_OFFER.SELECT_ACTIVE, [
    tenantId, date, date, day, time, time, time, branchId || null,
  ]);
  return rows || [];
};

/**
 * How many more times each offer may be redeemed overall.
 *
 * null means "no limit" — deliberately distinct from 0, which means "limit
 * reached". Collapsing the two is how an offer with no cap stops firing.
 *
 * @param {Array<Object>} offers
 * @returns {Object<string, number|null>}
 */
const remainingByOffer = (offers) => Object.fromEntries(offers.map((o) => [
  o.Id,
  o.MaxTotalRedemptions === null || o.MaxTotalRedemptions === undefined
    ? null
    : Math.max(0, Number(o.MaxTotalRedemptions) - Number(o.RedemptionCount || 0)),
]));

/**
 * A cart line as the evaluator wants it.
 *
 * `hasManualDiscount` is the load-bearing one: a line a manager has already
 * discounted by hand is off limits to every offer, because goodwill plus a
 * buy-one-get-one is how a dish costs less than nothing.
 *
 * @param {Array<Object>} lines - From posbill.repository.getOrderLinesTx.
 * @returns {Array<Object>}
 */
// Two callers, two spellings of the same field, and they must not disagree:
// posbill.repository.getOrderLinesTx builds `id`, while the till's /preview
// endpoint takes `itemId` (see offer.schemas.previewSchema). Reading only `id`
// meant every ITEM_QTY trigger silently counted ZERO qualifying items on the
// preview path — the cashier was told "not enough items" while looking at a
// cart full of them, and only the settle path ever matched.
const toEvaluatorLines = (lines) => (lines || []).map((l) => ({
  ref: l.ref,
  itemId: l.itemId ?? l.id ?? null,
  categoryId: l.categoryId ?? null,
  name: l.name,
  unitAmount: Number(l.unitAmount || 0),
  quantity: Number(l.quantity || 0),
  hasManualDiscount: !!l.discount,
}));

/**
 * Run every live offer against a cart. Reads nothing it does not need, writes
 * nothing at all.
 *
 * @param {Object} conn
 * @param {Object} args - { lines, billAmount, branchId, at }
 * @param {string} tenantId
 * @returns {Promise<Object>} The evaluator's result, plus the offers considered.
 */
const evaluateTx = async (conn, {
  lines, billAmount, branchId, at, posCustomerId,
}, tenantId) => {
  const offers = await activeOffersTx(conn, { branchId, at }, tenantId);
  if (offers.length === 0) {
    return {
      lineDiscounts: {}, applied: [], earned: [], skipped: [], totalDiscount: 0, considered: 0,
    };
  }

  // What THIS customer has already taken today. A walk-in has no id, so no
  // per-customer cap can apply to them — which is the honest answer: the limit
  // is per customer, and an anonymous sale identifies none.
  const takenToday = {};
  if (posCustomerId) {
    const [rows] = await conn.execute(
      QUERIES.POS_OFFER_REDEMPTION.COUNT_FOR_CUSTOMER_TODAY, [tenantId, posCustomerId],
    );
    (rows || []).forEach((r) => { takenToday[r.OfferId] = Number(r.n || 0); });
  }
  const remainingForCustomer = Object.fromEntries(offers
    .filter((o) => o.MaxPerCustomerPerDay !== null && o.MaxPerCustomerPerDay !== undefined)
    .map((o) => [
      o.Id,
      Math.max(0, Number(o.MaxPerCustomerPerDay) - Number(takenToday[o.Id] || 0)),
    ]));

  const result = evaluator.evaluate({
    offers,
    lines: toEvaluatorLines(lines),
    billAmount,
    remainingByOffer: remainingByOffer(offers),
    remainingForCustomer,
  });

  // Campaign names ride along so the till and the bill can say WHICH promotion,
  // not merely that one applied.
  const named = (list) => list.map((x) => ({
    ...x,
    campaignName: offers.find((o) => o.Id === x.offerId)?.CampaignName || null,
  }));

  return {
    ...result,
    applied: named(result.applied),
    earned: named(result.earned),
    skipped: named(result.skipped),
    considered: offers.length,
  };
};

/**
 * The till's preview — the "Check offers" button.
 *
 * Read-only, and deliberately NOT the authority. The settle path re-runs the
 * same evaluation inside its own transaction and writes the discounts itself,
 * so a cashier who never presses this button still gets a correct bill. It
 * exists so somebody can SEE what is about to happen.
 */
const preview = ({ lines, billAmount, branchId, at, posCustomerId }, tenantId) =>
  withConnection((conn) => evaluateTx(
    conn, { lines, billAmount, branchId, at, posCustomerId }, tenantId,
  ));

/**
 * Merge offer discounts into the ones a cashier typed.
 *
 * MANUAL WINS, ALWAYS. The evaluator already refuses to touch a manually
 * discounted line, so this is belt and braces — but it is the kind of belt
 * worth wearing when the failure mode is a negative bill.
 *
 * @param {Object} manual - LineDiscounts from the request.
 * @param {Object} fromOffers
 * @returns {Object}
 */
const mergeLineDiscounts = (manual, fromOffers) => {
  const out = { ...(fromOffers || {}) };
  Object.entries(manual || {}).forEach(([ref, value]) => { out[ref] = value; });
  return out;
};

/**
 * Record what actually happened, inside the settle transaction.
 *
 * On the same transaction on purpose: a redemption that survived a rolled-back
 * sale would be a campaign charged for a bill nobody paid, and the budget cap
 * would slowly starve on discounts never given.
 *
 * @param {Object} conn - The settle transaction.
 * @param {Object} args - { applied, billId, transactionDetailLogId, branchId,
 *                          contactDetailId, billGrossAmount }
 * @param {string} tenantId
 * @param {string} userPhone
 * @returns {Promise<number>} How many redemption rows were written.
 */
const recordRedemptionsTx = async (conn, {
  applied = [], billId, transactionDetailLogId, branchId, posCustomerId, billGrossAmount,
}, tenantId, userPhone) => {
  let written = 0;

  for (const entry of applied) {
    const spend = Number(entry.discountAmount || 0);

    for (const award of entry.awards || []) {
      // eslint-disable-next-line no-await-in-loop
      await conn.execute(QUERIES.POS_OFFER_REDEMPTION.INSERT, [
        uuidv4(), tenantId, entry.offerId, entry.campaignId, branchId || null,
        billId || null, transactionDetailLogId || null, posCustomerId || null,
        award.ref || null, award.itemId || null, Number(award.quantity || 0),
        Number(award.discountAmount || 0), billGrossAmount ?? null,
        userPhone, userPhone, userPhone,
      ]);
      written += 1;
    }

    // The counters the "is it still running" query reads. Kept beside the rows
    // rather than derived, so the budget check on the next bill is an index
    // lookup instead of a scan of every redemption ever made.
    // eslint-disable-next-line no-await-in-loop
    await conn.execute(QUERIES.POS_OFFER.BUMP_REDEMPTIONS, [
      (entry.awards || []).length, entry.offerId, tenantId,
    ]);
    // eslint-disable-next-line no-await-in-loop
    await conn.execute(QUERIES.POS_CAMPAIGN.ADD_SPEND, [spend, entry.campaignId, tenantId]);
  }

  if (written > 0) {
    logger.info('Offers redeemed', {
      tenantId, billId, transactionDetailLogId, redemptions: written,
      givenAway: applied.reduce((s, a) => s + Number(a.discountAmount || 0), 0),
    });
  }
  return written;
};

module.exports = {
  activeOffersTx,
  evaluateTx,
  preview,
  mergeLineDiscounts,
  recordRedemptionsTx,
  toEvaluatorLines,
  remainingByOffer,
};
