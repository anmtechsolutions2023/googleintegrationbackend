// src/modules/posoffer/offer.service.js
//
// One offer: a trigger, a reward, and its limits.
//
// The VALIDATION here is the interesting part. Joi checks the envelope; this
// checks that the rule makes sense as a rule — a trigger that names no item, a
// "buy 2 get 5 free" that hands over the whole cart, a reward pointing at
// nothing. Refusing those at the door is much better than the evaluator having
// to be clever about nonsense at 8pm on a Friday.

const { v4: uuidv4 } = require('uuid');
const { withConnection } = require('../../utils/dbHelper');
const { QUERIES } = require('../../config/constants');
const { logger } = require('../../utils/logger');
const { HttpError } = require('../../middleware/errorHandler');
const MESSAGES = require('../../config/messages');
const { TRIGGER, REWARD, APPLY_TO } = require('./offer.evaluator');

const bad = (message) => { throw new HttpError(message, MESSAGES.HTTP_STATUS.BAD_REQUEST); };

/**
 * Is this a rule that can actually fire?
 *
 * Every message names the field and what it needs, because "invalid offer" sends
 * somebody back to a form with six controls and no idea which one is wrong.
 *
 * @param {Object} d
 */
const assertCoherent = (d) => {
  if (d.TriggerKind === TRIGGER.ITEM_QTY) {
    if (!d.TriggerItemId) bad('An item trigger needs an item.');
    if (!(Number(d.TriggerMinQty) > 0)) bad('An item trigger needs a minimum quantity above zero.');
  } else if (d.TriggerKind === TRIGGER.CATEGORY_QTY) {
    if (!d.TriggerCategoryId) bad('A category trigger needs a category.');
    if (!(Number(d.TriggerMinQty) > 0)) bad('A category trigger needs a minimum quantity above zero.');
  } else if (d.TriggerKind === TRIGGER.BILL_AMOUNT) {
    if (!(Number(d.TriggerMinAmount) > 0)) bad('A bill trigger needs an amount above zero.');
  } else {
    bad(`Trigger must be one of: ${Object.values(TRIGGER).join(', ')}.`);
  }

  if (d.RewardKind === REWARD.SPECIFIC_ITEM) {
    if (!d.RewardItemId) bad('A specific-item reward needs an item.');
    // "Buy 1 Plain Tea, get 1 Plain Tea free" is a same-item offer spelled the
    // long way — and spelled that way it escapes the check below that stops an
    // offer making every qualifying item free.
    if (d.TriggerKind === TRIGGER.ITEM_QTY && d.RewardItemId === d.TriggerItemId) {
      bad('The reward is the same item as the trigger — choose “the same item” '
        + 'as the reward instead, so the buy-this-many rule applies.');
    }
  } else if (d.RewardKind === REWARD.SAME_ITEM) {
    if (d.TriggerKind === TRIGGER.BILL_AMOUNT) {
      // "Spend ₹500, get the same item free" names no item at all.
      bad('A bill trigger cannot reward “the same item” — name the item to give away.');
    }
    // Buy 2, get 2 free is not an offer; it is everything being free. The
    // evaluator has a floor under this, but a rule nobody can express wrongly
    // is better than one caught later.
    if (Number(d.RewardQuantity || 1) >= Number(d.TriggerMinQty || 0)) {
      bad('Free quantity must be less than the quantity that triggers it, '
        + 'or every qualifying item would be free.');
    }
  } else {
    bad(`Reward must be one of: ${Object.values(REWARD).join(', ')}.`);
  }

  const pct = Number(d.RewardPercent);
  if (!(pct >= 0 && pct <= 100)) bad('Discount percent must be between 0 and 100.');
  if (d.ApplyTo && !Object.values(APPLY_TO).includes(d.ApplyTo)) {
    bad(`Apply-to must be one of: ${Object.values(APPLY_TO).join(', ')}.`);
  }
};

/**
 * The rule in one sentence.
 *
 * Built on the server so the till, the campaign screen and the audit log all
 * describe an offer the same way. A rule engine nobody can read back is a rule
 * engine nobody trusts.
 *
 * @param {Object} o - An offer row, ideally with the joined names.
 * @returns {string}
 */
const describe = (o) => {
  const qty = (n) => (Number(n) % 1 === 0 ? String(Number(n)) : Number(n).toFixed(2));
  const trigger = o.TriggerKind === TRIGGER.BILL_AMOUNT
    ? `When a bill reaches ₹${qty(o.TriggerMinAmount)}`
    : `When a bill has ${qty(o.TriggerMinQty)} or more of `
      + `${o.TriggerItemName || o.TriggerCategoryName || 'the chosen items'}`;

  const what = o.RewardKind === REWARD.SAME_ITEM
    ? 'of them'
    : `× ${o.RewardItemName || 'the reward item'}`;
  const off = Number(o.RewardPercent) === 100
    ? 'free'
    : `${qty(o.RewardPercent)}% off`;
  const which = o.RewardKind === REWARD.SAME_ITEM
    ? ` — the ${o.ApplyTo === APPLY_TO.DEAREST ? 'most expensive' : 'cheapest'} one`
    : '';

  return `${trigger}, make ${qty(o.RewardQuantity)} ${what} ${off}${which}. `
    + `At most ${o.MaxPerBill} per bill.`;
};

const decorate = (row) => ({ ...row, Sentence: describe(row) });

const getByCampaign = (campaignId, tenantId) => withConnection(async (conn) => {
  const [rows] = await conn.execute(QUERIES.POS_OFFER.SELECT_BY_CAMPAIGN, [campaignId, tenantId]);
  return (rows || []).map(decorate);
});

const getById = (id, tenantId) => withConnection(async (conn) => {
  const [rows] = await conn.execute(QUERIES.POS_OFFER.SELECT_BY_ID, [id, tenantId]);
  if (!rows.length) throw new HttpError('Offer not found.', MESSAGES.HTTP_STATUS.NOT_FOUND);
  return decorate(rows[0]);
});

const create = (campaignId, d, tenantId, userPhone) => withConnection(async (conn) => {
  assertCoherent(d);
  const id = uuidv4();
  await conn.execute(QUERIES.POS_OFFER.INSERT, [
    id, tenantId, campaignId, d.Name, d.SortOrder || 0,
    d.TriggerKind, d.TriggerItemId || null, d.TriggerCategoryId || null,
    d.TriggerMinQty ?? null, d.TriggerMinAmount ?? null,
    d.RewardKind, d.RewardItemId || null, d.RewardQuantity ?? 1, d.RewardPercent ?? 100,
    d.ApplyTo || APPLY_TO.CHEAPEST, d.MaxPerBill ?? 1,
    d.MaxPerCustomerPerDay ?? null, d.MaxTotalRedemptions ?? null,
    userPhone, userPhone,
  ]);
  logger.info('Offer created', { tenantId, offerId: id, campaignId, name: d.Name, userPhone });
  return { id };
});

const update = (id, d, tenantId, userPhone) => withConnection(async (conn) => {
  const [rows] = await conn.execute(QUERIES.POS_OFFER.SELECT_BY_ID, [id, tenantId]);
  if (!rows.length) throw new HttpError('Offer not found.', MESSAGES.HTTP_STATUS.NOT_FOUND);
  const merged = { ...rows[0], ...d };
  assertCoherent(merged);

  await conn.execute(QUERIES.POS_OFFER.UPDATE, [
    merged.Name, merged.SortOrder || 0, merged.TriggerKind,
    merged.TriggerItemId || null, merged.TriggerCategoryId || null,
    merged.TriggerMinQty ?? null, merged.TriggerMinAmount ?? null,
    merged.RewardKind, merged.RewardItemId || null,
    merged.RewardQuantity ?? 1, merged.RewardPercent ?? 100,
    merged.ApplyTo || APPLY_TO.CHEAPEST, merged.MaxPerBill ?? 1,
    merged.MaxPerCustomerPerDay ?? null, merged.MaxTotalRedemptions ?? null,
    userPhone, id, tenantId,
  ]);
  return { id };
});

/** Soft delete — its redemptions are history, and history keeps its reasons. */
const remove = (id, tenantId, userPhone) => withConnection(async (conn) => {
  const [res] = await conn.execute(QUERIES.POS_OFFER.SOFT_DELETE, [userPhone, id, tenantId]);
  if (!res.affectedRows) throw new HttpError('Offer not found.', MESSAGES.HTTP_STATUS.NOT_FOUND);
  return { id };
});

module.exports = { getByCampaign, getById, create, update, remove, describe, assertCoherent };
