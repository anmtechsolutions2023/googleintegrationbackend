// src/modules/posoffer/offer.evaluator.js
//
// Cart in, discounts out. THAT IS ALL THIS FILE DOES.
//
// No database, no HTTP, no clock it did not receive, no logging. Every input is
// an argument and the result is a value. That is not tidiness for its own sake:
//
//   · The till previews offers with this code, and the server ENFORCES them
//     with the same code. One implementation, so the preview a cashier reads
//     and the discount the customer is actually given cannot disagree.
//   · A rule engine is where the expensive mistakes live. Pure, it can be
//     tested exhaustively without a fixture, a transaction or a running clock.
//
// WHAT IT PRODUCES
// The line discounts a cashier would have typed — `{ "<orderId>#<idx>": {type,
// value} }`, exactly the shape posbill already takes. An offer is not a second
// way to price a bill; it is an automatic producer of the discounts the till
// already understands, and posbill.recomputeTotals keeps deciding how the money
// works.

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const TRIGGER = { ITEM_QTY: 'ITEM_QTY', CATEGORY_QTY: 'CATEGORY_QTY', BILL_AMOUNT: 'BILL_AMOUNT' };
const REWARD = { SAME_ITEM: 'SAME_ITEM', SPECIFIC_ITEM: 'SPECIFIC_ITEM' };
const APPLY_TO = { CHEAPEST: 'CHEAPEST', DEAREST: 'DEAREST' };

// Why an offer did not fire. A silent "no" is what makes staff stop trusting an
// offer engine and go back to typing discounts by hand, so every refusal has a
// code and a sentence.
const SKIP = {
  NOT_ENOUGH_ITEMS: 'NOT_ENOUGH_ITEMS',
  BILL_TOO_SMALL: 'BILL_TOO_SMALL',
  REWARD_NOT_IN_CART: 'REWARD_NOT_IN_CART',
  LINE_ALREADY_DISCOUNTED: 'LINE_ALREADY_DISCOUNTED',
  BEATEN_BY_ANOTHER_OFFER: 'BEATEN_BY_ANOTHER_OFFER',
  LIMIT_REACHED: 'LIMIT_REACHED',
  // The rule itself cannot fire — "buy 1, get 1 of the same free" makes every
  // qualifying item free, so the floor that prevents that leaves nothing to
  // give. Reported rather than silently skipped: the fix is in the offer, and
  // nobody finds that by adding another cup of tea.
  MISCONFIGURED: 'MISCONFIGURED',
};

/**
 * What one line is worth before anything is taken off it.
 * @param {Object} line
 * @returns {number}
 */
const lineValue = (line) => round2(Number(line.unitAmount || 0) * Number(line.quantity || 0));

/** Unit price, used to rank qualifying lines. */
const unitOf = (line) => Number(line.unitAmount || 0);

/**
 * Does this line satisfy the offer's trigger?
 *
 * @param {Object} offer
 * @param {Object} line
 * @returns {boolean}
 */
const lineMatchesTrigger = (offer, line) => {
  if (offer.TriggerKind === TRIGGER.ITEM_QTY) return line.itemId === offer.TriggerItemId;
  if (offer.TriggerKind === TRIGGER.CATEGORY_QTY) return line.categoryId === offer.TriggerCategoryId;
  return false;
};

/**
 * Is the reward the very thing that triggered it?
 *
 * TRUE for SAME_ITEM, and also for a SPECIFIC_ITEM offer whose reward item IS
 * the trigger item — "buy 1 Plain Tea, get 1 Plain Tea free" is a same-item
 * offer however it was spelled in the form. Without this the
 * everything-cannot-be-free floor below is bypassed by picking the same item
 * twice, which is exactly what somebody building a BOGO does by accident.
 *
 * @param {Object} offer
 * @returns {boolean}
 */
const rewardsTheTrigger = (offer) => offer.RewardKind === REWARD.SAME_ITEM
  || (offer.RewardKind === REWARD.SPECIFIC_ITEM
      && offer.TriggerKind === TRIGGER.ITEM_QTY
      && !!offer.RewardItemId
      && offer.RewardItemId === offer.TriggerItemId);

/** Which lines could receive this offer's reward. */
const rewardCandidates = (offer, lines) => {
  if (offer.RewardKind === REWARD.SPECIFIC_ITEM) {
    return lines.filter((l) => l.itemId === offer.RewardItemId);
  }
  // SAME_ITEM: the reward is one of the very lines that triggered it.
  return lines.filter((l) => lineMatchesTrigger(offer, l));
};

/**
 * Evaluate ONE offer against a cart.
 *
 * @param {Object} offer
 * @param {Array<Object>} lines - { ref, itemId, categoryId, unitAmount, quantity, hasManualDiscount }
 * @param {Object} ctx - { billAmount, alreadyClaimedRefs, remainingRedemptions }
 * @returns {{applied: boolean, awards: Array, skip: string|null, detail: Object}}
 */
const evaluateOffer = (offer, lines, ctx) => {
  const nope = (skip, detail = {}) => ({ applied: false, awards: [], skip, detail });

  // ── Limits that do not depend on the cart at all ───────────────────────────
  // Two different sentences, because they are two different things to tell a
  // customer: "you have had yours today" is not "this promotion is over".
  if (ctx.remainingForCustomer !== null && ctx.remainingForCustomer !== undefined
      && ctx.remainingForCustomer <= 0) {
    return nope(SKIP.LIMIT_REACHED, {
      reason: 'This customer has already taken this offer the maximum number of times today',
    });
  }
  if (ctx.remainingRedemptions !== null && ctx.remainingRedemptions <= 0) {
    return nope(SKIP.LIMIT_REACHED, { reason: 'This offer has reached its total redemption limit' });
  }

  // ── The trigger ────────────────────────────────────────────────────────────
  // `cycles` is how many times the trigger is satisfied. Six chai on a "buy 2
  // get 1" is THREE redemptions, not one — getting this wrong is the difference
  // between an offer that works and one that quietly under-gives all evening.
  let cycles = 0;
  let qualifyingQty = 0;

  if (offer.TriggerKind === TRIGGER.BILL_AMOUNT) {
    const min = Number(offer.TriggerMinAmount || 0);
    if (Number(ctx.billAmount || 0) < min) {
      return nope(SKIP.BILL_TOO_SMALL, {
        needed: min,
        // How much more, so the till can say "₹15 more and it qualifies"
        // rather than only "it does not".
        shortBy: round2(min - Number(ctx.billAmount || 0)),
      });
    }
    // A bill over the threshold earns the reward ONCE. Earning it again for
    // every further ₹500 is a different offer, and one nobody asked for.
    cycles = 1;
  } else {
    const qualifying = lines.filter((l) => lineMatchesTrigger(offer, l));
    qualifyingQty = qualifying.reduce((s, l) => s + Number(l.quantity || 0), 0);
    const need = Number(offer.TriggerMinQty || 0);
    if (need <= 0 || qualifyingQty < need) {
      return nope(SKIP.NOT_ENOUGH_ITEMS, {
        needed: need, have: qualifyingQty, shortBy: round2(need - qualifyingQty),
      });
    }
    cycles = Math.floor(qualifyingQty / need);
  }

  // ── The reward ─────────────────────────────────────────────────────────────
  let candidates = rewardCandidates(offer, lines);

  // A line somebody has already discounted by hand is off limits. A manager's
  // goodwill 20% plus a buy-one-get-one is how a dish costs less than nothing.
  const manual = candidates.filter((l) => l.hasManualDiscount);
  candidates = candidates.filter((l) => !l.hasManualDiscount);

  // …and a line another offer already claimed. Offers do not stack.
  const claimed = candidates.filter((l) => ctx.alreadyClaimedRefs.has(l.ref));
  candidates = candidates.filter((l) => !ctx.alreadyClaimedRefs.has(l.ref));

  if (candidates.length === 0) {
    if (claimed.length > 0) {
      return nope(SKIP.BEATEN_BY_ANOTHER_OFFER, {
        reason: 'Another offer already applies to the only line this could discount',
      });
    }
    if (manual.length > 0) {
      return nope(SKIP.LINE_ALREADY_DISCOUNTED, {
        reason: 'A discount was typed in by hand on that line, and an offer never stacks on one',
      });
    }
    // The customer has EARNED it but the item is not in the cart. Not a
    // failure — something for the till to offer to add, because a free item has
    // to exist as a line before it can be discounted.
    return nope(SKIP.REWARD_NOT_IN_CART, {
      rewardItemId: offer.RewardItemId,
      earned: true,
      reason: 'Qualifies, but the reward item is not in the order',
    });
  }

  // WHICH line gets it. Stated rather than assumed: a ₹15 chai and a ₹20 masala
  // chai both qualify, and two tills answering differently is a customer being
  // right both times.
  const ranked = [...candidates].sort((a, b) => (
    offer.ApplyTo === APPLY_TO.DEAREST ? unitOf(b) - unitOf(a) : unitOf(a) - unitOf(b)
  ));

  const perBillCap = Math.max(1, Number(offer.MaxPerBill || 1));
  const perCycle = Math.max(1, Number(offer.RewardQuantity || 1));
  // Earned by the cart, then capped by the offer's own limits.
  let budget = Math.min(cycles * perCycle, perBillCap);
  if (ctx.remainingForCustomer !== null && ctx.remainingForCustomer !== undefined) {
    budget = Math.min(budget, ctx.remainingForCustomer);
  }
  // At least one qualifying item per cycle must be PAID for. "Buy 2 get 1 free"
  // means one paid and one free; a misconfigured "buy 2 get 5 free" must not
  // hand over the whole cart. The schema refuses that configuration, and this
  // is the floor under it if one ever reaches the engine anyway.
  if (rewardsTheTrigger(offer)) {
    const floor = Math.max(0, qualifyingQty - cycles);
    // budget > 0 before the floor but 0 after means the offer, as written,
    // would hand over every qualifying item. That is a rule that can never fire
    // — say so, rather than reporting "not enough items" at a cart that has
    // plenty.
    if (budget > 0 && floor === 0) {
      return nope(SKIP.MISCONFIGURED, {
        reason: `Every ${offer.TriggerMinQty > 1 ? `${offer.TriggerMinQty} ` : ''}`
          + 'qualifying item would be free. Ask for more than you give away — '
          + 'a buy-one-get-one needs a trigger of 2 and a reward of 1.',
      });
    }
    budget = Math.min(budget, floor);
  }
  if (ctx.remainingRedemptions !== null) budget = Math.min(budget, ctx.remainingRedemptions);

  const percent = Math.min(100, Math.max(0, Number(offer.RewardPercent || 0)));
  const awards = [];

  for (const line of ranked) {
    if (budget <= 0) break;
    // How many of THIS line the remaining budget can take. The "not everything
    // is free" rule is a property of the whole cart, computed above — applying
    // it per line would refuse a perfectly good offer whenever two chai
    // happened to be rung up as two lines of one rather than one line of two.
    const take = Math.min(budget, Number(line.quantity || 0));
    if (take <= 0) continue;

    awards.push({
      ref: line.ref,
      itemId: line.itemId,
      itemName: line.name,
      quantity: take,
      percent,
      // What it costs, so the caller never has to re-derive it to report on it.
      discountAmount: round2(unitOf(line) * take * (percent / 100)),
    });
    budget -= take;
  }

  if (awards.length === 0) {
    return nope(SKIP.REWARD_NOT_IN_CART, {
      rewardItemId: offer.RewardItemId, earned: true,
      reason: 'Qualifies, but no line can take the reward',
    });
  }

  return {
    applied: true,
    awards,
    skip: null,
    detail: { totalDiscount: round2(awards.reduce((s, a) => s + a.discountAmount, 0)) },
  };
};

/**
 * Evaluate a whole cart against every candidate offer.
 *
 * OFFERS DO NOT STACK. Where two offers could discount the same line, the one
 * worth more to the customer takes it and the other stands down — visibly, with
 * a reason. Two offers each taking 50% off one dish must not make it free.
 *
 * @param {Object} args
 * @param {Array<Object>} args.offers - Candidates, already filtered for date/branch/status.
 * @param {Array<Object>} args.lines  - { ref, itemId, categoryId, name, unitAmount, quantity, hasManualDiscount }
 * @param {number} args.billAmount    - Cart value before any offer.
 * @param {Object} [args.remainingByOffer] - { offerId: n|null } total redemptions left.
 * @returns {{lineDiscounts: Object, applied: Array, earned: Array, skipped: Array, totalDiscount: number}}
 */
const evaluate = ({
  offers = [], lines = [], billAmount = 0,
  remainingByOffer = {}, remainingForCustomer = {},
}) => {
  // A cart line with no catalogue item behind it can match no item or category
  // trigger — so every such offer reports NOT_ENOUGH_ITEMS, and "1 more needed"
  // is a lie: adding another one would not help. Counted here so a caller can
  // say what is actually wrong instead.
  const unidentified = lines.filter((l) => !l.itemId && !l.categoryId).length;
  const claimed = new Set();
  const applied = [];
  const earned = [];
  const skipped = [];

  // Best-first. An offer worth more to the customer should not lose a line to a
  // cheaper one that merely happened to be evaluated earlier — which is exactly
  // what an unsorted pass does, silently and only sometimes.
  const worth = (offer) => {
    const dry = evaluateOffer(offer, lines, {
      billAmount, alreadyClaimedRefs: new Set(), remainingRedemptions: null,
    });
    return dry.applied ? dry.detail.totalDiscount : -1;
  };
  const ordered = [...offers]
    .map((o) => ({ offer: o, value: worth(o) }))
    .sort((a, b) => (b.value - a.value)
      || (Number(a.offer.SortOrder || 0) - Number(b.offer.SortOrder || 0)));

  ordered.forEach(({ offer }) => {
    const remaining = Object.prototype.hasOwnProperty.call(remainingByOffer, offer.Id)
      ? remainingByOffer[offer.Id]
      : null;

    const perCustomer = Object.prototype.hasOwnProperty.call(remainingForCustomer, offer.Id)
      ? remainingForCustomer[offer.Id]
      : null;

    const result = evaluateOffer(offer, lines, {
      billAmount,
      alreadyClaimedRefs: claimed,
      remainingRedemptions: remaining,
      remainingForCustomer: perCustomer,
    });

    const summary = {
      offerId: offer.Id,
      campaignId: offer.CampaignId,
      name: offer.Name,
    };

    if (result.applied) {
      result.awards.forEach((a) => claimed.add(a.ref));
      applied.push({ ...summary, awards: result.awards, discountAmount: result.detail.totalDiscount });
      return;
    }

    // Earned but unclaimed is NOT a failure — it is the offer the till should
    // put in front of somebody, because the reward has to be in the cart before
    // it can be discounted.
    if (result.skip === SKIP.REWARD_NOT_IN_CART && result.detail.earned) {
      earned.push({ ...summary, ...result.detail });
      return;
    }
    // `reason` is the machine-readable code a caller branches on; `message` is
    // the sentence a cashier reads. Spreading `detail` last used to overwrite
    // the code with the sentence, so nothing downstream could tell a
    // budget-exhausted offer from a too-small bill.
    const { reason: message, ...detail } = result.detail;
    skipped.push({ ...summary, reason: result.skip, message: message || null, ...detail });
  });

  // The shape posbill already takes for a hand-typed line discount. Nothing
  // downstream has to know an offer was involved.
  //
  // As an AMOUNT, never as the award's percent. An award frees `quantity` UNITS
  // of a line — one tea out of two — while a line discount applies to the WHOLE
  // line. Emitting `{percent: 100}` for "one of these two is free" told the
  // pricing engine to take 100% off both: the offer reported ₹15 and charged
  // ₹0, and buy-one-get-one gave away the pair. The award already carries the
  // money it costs, and that figure is what every caller reports, so it is the
  // one that must reach the bill.
  const lineDiscounts = {};
  applied.forEach((a) => a.awards.forEach((award) => {
    lineDiscounts[award.ref] = { type: 'amount', value: round2(award.discountAmount) };
  }));

  return {
    lineDiscounts,
    applied,
    earned,
    skipped,
    unidentifiedLines: unidentified,
    totalDiscount: round2(applied.reduce((s, a) => s + a.discountAmount, 0)),
  };
};

module.exports = {
  evaluate, evaluateOffer, rewardsTheTrigger,
  TRIGGER, REWARD, APPLY_TO, SKIP, round2,
};
