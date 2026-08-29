// src/__tests__/modules/offer.evaluator.test.js
//
// The rule engine. Every case here is money in a direction somebody notices.
//
// The evaluator is pure, so all of this runs with no database, no transaction
// and no clock — which is the point of it being pure. The till previews with
// this code and the server enforces with it, so a rule proved here is proved on
// both sides at once.

const { evaluate, SKIP } = require('../../modules/posoffer/offer.evaluator');

const CHAI = 'item-chai';
const PANEER = 'item-paneer';
const JAMUN = 'item-jamun';
const DESSERTS = 'cat-desserts';

const line = (over = {}) => ({
  ref: 'o1#0', itemId: CHAI, categoryId: null, name: 'Masala Chai',
  unitAmount: 25, quantity: 1, hasManualDiscount: false, ...over,
});

const offer = (over = {}) => ({
  Id: 'off-1', CampaignId: 'camp-1', Name: 'Buy 2 chai get 1 free', SortOrder: 0,
  TriggerKind: 'ITEM_QTY', TriggerItemId: CHAI, TriggerCategoryId: null,
  TriggerMinQty: 2, TriggerMinAmount: null,
  RewardKind: 'SAME_ITEM', RewardItemId: null, RewardQuantity: 1, RewardPercent: 100,
  ApplyTo: 'CHEAPEST', MaxPerBill: 1, ...over,
});

const run = (offers, lines, billAmount = 0, remainingByOffer = {}) =>
  evaluate({ offers, lines, billAmount, remainingByOffer });

// ── Buy N get M ──────────────────────────────────────────────────────────────
describe('buy 2 chai, get 1 free', () => {
  test('does nothing with one chai, and says how many short', () => {
    const out = run([offer()], [line({ quantity: 1 })]);
    expect(out.applied).toHaveLength(0);
    expect(out.skipped[0]).toMatchObject({ reason: SKIP.NOT_ENOUGH_ITEMS, needed: 2, have: 1, shortBy: 1 });
  });

  test('fires at two, making one free', () => {
    const out = run([offer()], [line({ quantity: 2 })]);
    expect(out.applied).toHaveLength(1);
    expect(out.applied[0].awards[0]).toMatchObject({ quantity: 1, percent: 100, discountAmount: 25 });
    expect(out.totalDiscount).toBe(25);
  });

  // Buying 2 and getting 2 free is not the offer anybody wrote. The schema
  // refuses "buy 2 get 5", and this is the floor under it if one ever reaches
  // the engine: at least one qualifying item per cycle is always paid for.
  test('never gives the whole cart away', () => {
    const out = run([offer({ RewardQuantity: 5, MaxPerBill: 5 })], [line({ quantity: 2 })]);
    expect(out.applied[0].awards[0].quantity).toBe(1);
  });

  test('six chai is three redemptions, not one', () => {
    const out = run([offer({ MaxPerBill: 9 })], [line({ quantity: 6 })]);
    expect(out.applied[0].awards[0].quantity).toBe(3);
    expect(out.totalDiscount).toBe(75);
  });

  test('honours the per-bill cap', () => {
    const out = run([offer({ MaxPerBill: 2 })], [line({ quantity: 6 })]);
    expect(out.applied[0].awards[0].quantity).toBe(2);
    expect(out.totalDiscount).toBe(50);
  });

  // As an AMOUNT, not the award's percent. The award frees ONE unit of a
  // two-unit line; a line discount applies to the WHOLE line. Emitting
  // {percent: 100} told the pricing engine to take 100% off both chai — the
  // offer reported ₹25 and charged ₹0, and buy-two-get-one gave away the pair.
  test('produces the discount shape the till already takes', () => {
    const out = run([offer()], [line({ ref: 'o1#3', quantity: 2 })]);
    expect(out.lineDiscounts).toEqual({ 'o1#3': { type: 'amount', value: 25 } });
  });

  // The invariant the shape exists to keep: what an offer SAYS it costs is what
  // the bill actually takes off.
  test('the emitted discount equals the discount it reports', () => {
    const out = run([offer()], [line({ quantity: 2 })]);
    const emitted = out.lineDiscounts['o1#0'];
    expect(emitted.type).toBe('amount');
    expect(emitted.value).toBe(out.totalDiscount);
  });

  // A whole line free is the same figure either way — this is the case the
  // percent form got right, and it must keep working.
  test('and still matches when every unit of the line is free', () => {
    const out = run(
      [offer({ TriggerMinQty: 1, RewardQuantity: 1, MaxPerBill: 1, RewardKind: 'SPECIFIC_ITEM', RewardItemId: JAMUN })],
      [line({ quantity: 3 }), line({ ref: 'o1#1', itemId: JAMUN, name: 'Gulab Jamun', unitAmount: 40, quantity: 1 })],
    );
    expect(out.lineDiscounts['o1#1']).toEqual({ type: 'amount', value: 40 });
    expect(out.totalDiscount).toBe(40);
  });
});

describe('the second one at half price', () => {
  test('takes 50% off one line', () => {
    const out = run([offer({ Name: 'Second at half', RewardPercent: 50 })], [line({ quantity: 2 })]);
    expect(out.applied[0].awards[0]).toMatchObject({ percent: 50, discountAmount: 12.5 });
  });
});

// ── Which line gets it ───────────────────────────────────────────────────────
// A ₹15 chai and a ₹20 masala chai both qualify. Left unstated, two tills
// answer differently and the customer is right both times.
describe('which qualifying line is discounted', () => {
  const two = [
    line({ ref: 'o1#0', unitAmount: 15, name: 'Plain Tea' }),
    line({ ref: 'o1#1', unitAmount: 25, name: 'Masala Chai' }),
  ];

  test('cheapest by default', () => {
    const out = run([offer({ TriggerMinQty: 2 })], two);
    expect(out.applied[0].awards[0]).toMatchObject({ ref: 'o1#0', discountAmount: 15 });
  });

  test('dearest when the offer says so', () => {
    const out = run([offer({ TriggerMinQty: 2, ApplyTo: 'DEAREST' })], two);
    expect(out.applied[0].awards[0]).toMatchObject({ ref: 'o1#1', discountAmount: 25 });
  });
});

// ── Cross-product and category ───────────────────────────────────────────────
describe('buy X, get a different Y', () => {
  const crossSell = offer({
    Name: 'Buy paneer, get a jamun free',
    TriggerItemId: PANEER, TriggerMinQty: 1,
    RewardKind: 'SPECIFIC_ITEM', RewardItemId: JAMUN,
  });

  test('discounts the reward item, not the trigger', () => {
    const out = run([crossSell], [
      line({ ref: 'o1#0', itemId: PANEER, unitAmount: 240, quantity: 1 }),
      line({ ref: 'o1#1', itemId: JAMUN, unitAmount: 25, quantity: 1 }),
    ]);
    expect(out.applied[0].awards[0]).toMatchObject({ ref: 'o1#1', itemId: JAMUN, discountAmount: 25 });
  });

  // Earned but unclaimed is NOT a failure — the reward has to exist as a line
  // before it can be discounted, so this is what the till offers to add.
  test('reports it as EARNED when the reward is not in the cart', () => {
    const out = run([crossSell], [line({ itemId: PANEER, unitAmount: 240 })]);
    expect(out.applied).toHaveLength(0);
    expect(out.skipped).toHaveLength(0);
    expect(out.earned[0]).toMatchObject({ rewardItemId: JAMUN, earned: true });
  });
});

describe('a category trigger', () => {
  test('counts every line in the category', () => {
    const catOffer = offer({
      TriggerKind: 'CATEGORY_QTY', TriggerItemId: null, TriggerCategoryId: DESSERTS,
      TriggerMinQty: 3,
    });
    const out = run([catOffer], [
      line({ ref: 'o1#0', itemId: JAMUN, categoryId: DESSERTS, quantity: 2, unitAmount: 25 }),
      line({ ref: 'o1#1', itemId: 'item-halwa', categoryId: DESSERTS, quantity: 1, unitAmount: 40 }),
    ]);
    expect(out.applied).toHaveLength(1);
    expect(out.applied[0].awards[0].ref).toBe('o1#0'); // cheapest
  });
});

// ── Bill-amount trigger ──────────────────────────────────────────────────────
describe('spend ₹500, get a free dessert', () => {
  const threshold = offer({
    Name: 'Free jamun over 500',
    TriggerKind: 'BILL_AMOUNT', TriggerItemId: null, TriggerMinQty: null, TriggerMinAmount: 500,
    RewardKind: 'SPECIFIC_ITEM', RewardItemId: JAMUN,
  });

  test('says how much MORE is needed, not merely that it failed', () => {
    const out = run([threshold], [line({ itemId: JAMUN, unitAmount: 25 })], 485);
    expect(out.skipped[0]).toMatchObject({ reason: SKIP.BILL_TOO_SMALL, needed: 500, shortBy: 15 });
  });

  test('fires at the threshold exactly', () => {
    const out = run([threshold], [line({ itemId: JAMUN, unitAmount: 25 })], 500);
    expect(out.applied[0].awards[0].discountAmount).toBe(25);
  });

  test('half off instead of free, when that is the offer', () => {
    const out = run([{ ...threshold, RewardPercent: 50 }], [line({ itemId: JAMUN, unitAmount: 25 })], 600);
    expect(out.applied[0].awards[0]).toMatchObject({ percent: 50, discountAmount: 12.5 });
  });
});

// ── Stacking ─────────────────────────────────────────────────────────────────
describe('when more than one offer fits', () => {
  // Two offers each taking 50% off one dish must not make it free.
  test('the better one takes the line and the other stands down', () => {
    const small = offer({ Id: 'off-small', Name: 'Half off', RewardPercent: 50 });
    const big = offer({ Id: 'off-big', Name: 'Free chai', RewardPercent: 100 });

    const out = run([small, big], [line({ quantity: 2 })]);

    expect(out.applied).toHaveLength(1);
    expect(out.applied[0].offerId).toBe('off-big');
    expect(out.skipped[0]).toMatchObject({ offerId: 'off-small', reason: SKIP.BEATEN_BY_ANOTHER_OFFER });
    expect(out.totalDiscount).toBe(25);
  });

  // The order they arrive in must not decide the outcome.
  test('and the outcome does not depend on evaluation order', () => {
    const small = offer({ Id: 'off-small', RewardPercent: 50 });
    const big = offer({ Id: 'off-big', RewardPercent: 100 });

    const a = run([small, big], [line({ quantity: 2 })]);
    const b = run([big, small], [line({ quantity: 2 })]);
    expect(a.applied[0].offerId).toBe(b.applied[0].offerId);
    expect(a.totalDiscount).toBe(b.totalDiscount);
  });

  test('two offers on DIFFERENT lines both apply', () => {
    const chaiOffer = offer({ Id: 'off-chai' });
    const paneerOffer = offer({
      Id: 'off-paneer', Name: 'Paneer half price',
      TriggerItemId: PANEER, TriggerMinQty: 2, RewardPercent: 50,
    });
    const out = run([chaiOffer, paneerOffer], [
      line({ ref: 'o1#0', itemId: CHAI, quantity: 2, unitAmount: 25 }),
      line({ ref: 'o1#1', itemId: PANEER, quantity: 2, unitAmount: 240 }),
    ]);
    expect(out.applied).toHaveLength(2);
    expect(out.totalDiscount).toBe(145); // 25 + 120
  });
});

// ── The manual-discount rule ─────────────────────────────────────────────────
// A manager's goodwill 20% plus a buy-one-get-one is how a dish costs less than
// nothing.
describe('a line somebody has already discounted by hand', () => {
  test('is off limits, and the offer says why', () => {
    const out = run([offer()], [line({ quantity: 2, hasManualDiscount: true })]);
    expect(out.applied).toHaveLength(0);
    // The CODE survives, and the sentence a cashier reads rides beside it.
    expect(out.skipped[0].reason).toBe(SKIP.LINE_ALREADY_DISCOUNTED);
    expect(out.skipped[0].message).toMatch(/typed in by hand/);
  });

  test('but another untouched line can still take the reward', () => {
    const out = run([offer({ TriggerMinQty: 2 })], [
      line({ ref: 'o1#0', unitAmount: 15, hasManualDiscount: true }),
      line({ ref: 'o1#1', unitAmount: 25 }),
    ]);
    expect(out.applied[0].awards[0].ref).toBe('o1#1');
  });
});

// ── Limits ───────────────────────────────────────────────────────────────────
describe('redemption limits', () => {
  test('an offer with none left does not fire', () => {
    const out = run([offer()], [line({ quantity: 2 })], 0, { 'off-1': 0 });
    expect(out.applied).toHaveLength(0);
    expect(out.skipped[0].reason).toBe(SKIP.LIMIT_REACHED);
  });

  test('and one with a few left is capped by them', () => {
    const out = run([offer({ MaxPerBill: 5, RewardQuantity: 5 })], [line({ quantity: 9 })], 0, { 'off-1': 2 });
    expect(out.applied[0].awards[0].quantity).toBe(2);
  });

  // ── Per customer, per day ──────────────────────────────────────────────
  // MaxPerCustomerPerDay was stored, validated and shown in the UI while
  // nothing on either path read it: an offer capped at "once a day" was
  // available on every bill of the day. These pin the cap to behaviour.
  describe('the per-customer daily cap', () => {
    const capped = (remainingForCustomer) => evaluate({
      offers: [offer()], lines: [line({ quantity: 2 })], billAmount: 0,
      remainingByOffer: {}, remainingForCustomer,
    });

    test('a customer who has used it up is refused, in words a cashier can repeat', () => {
      const out = capped({ 'off-1': 0 });
      expect(out.applied).toHaveLength(0);
      expect(out.skipped[0].reason).toBe(SKIP.LIMIT_REACHED);
      expect(out.skipped[0].message).toMatch(/customer/i);
    });

    test('a customer with one left still gets it', () => {
      expect(capped({ 'off-1': 1 }).applied).toHaveLength(1);
    });

    test('an uncapped offer is untouched by the map', () => {
      expect(capped({ 'other-offer': 0 }).applied).toHaveLength(1);
    });

    test('a walk-in — no customer, so no per-customer map — is not blocked', () => {
      // The honest answer: the limit is per customer, and an anonymous sale
      // identifies none. Blocking here would refuse offers to every walk-in.
      expect(capped(undefined).applied).toHaveLength(1);
      expect(capped({}).applied).toHaveLength(1);
    });

    test('the overall cap and the per-customer cap both bite, independently', () => {
      const both = (overall, perCustomer) => evaluate({
        offers: [offer()], lines: [line({ quantity: 2 })], billAmount: 0,
        remainingByOffer: { 'off-1': overall },
        remainingForCustomer: { 'off-1': perCustomer },
      });
      expect(both(0, 5).applied).toHaveLength(0);
      expect(both(5, 0).applied).toHaveLength(0);
      expect(both(5, 5).applied).toHaveLength(1);
    });
  });

  test('no entry means no limit', () => {
    const out = run([offer()], [line({ quantity: 2 })], 0, {});
    expect(out.applied).toHaveLength(1);
  });
});

// ── Purity ───────────────────────────────────────────────────────────────────
describe('the evaluator is pure', () => {
  test('does not mutate the cart or the offers it was given', () => {
    const lines = [line({ quantity: 2 })];
    const offers = [offer()];
    const snapshot = JSON.stringify({ lines, offers });

    run(offers, lines);

    expect(JSON.stringify({ lines, offers })).toBe(snapshot);
  });

  test('the same input gives the same answer, every time', () => {
    const lines = [line({ ref: 'o1#0', unitAmount: 15 }), line({ ref: 'o1#1', unitAmount: 25 })];
    const offers = [offer({ TriggerMinQty: 2 }), offer({ Id: 'off-2', RewardPercent: 50 })];

    const first = run(offers, lines, 900);
    for (let i = 0; i < 5; i += 1) {
      expect(run(offers, lines, 900)).toEqual(first);
    }
  });

  test('an empty cart is answered, not thrown at', () => {
    const out = run([offer()], []);
    expect(out).toMatchObject({ applied: [], totalDiscount: 0, lineDiscounts: {} });
  });

  test('no offers at all is answered too', () => {
    const out = run([], [line({ quantity: 2 })]);
    expect(out).toMatchObject({ applied: [], skipped: [], earned: [], totalDiscount: 0 });
  });
});

describe('money', () => {
  test('rounds to paise, never to a fraction of one', () => {
    const out = run([offer({ RewardPercent: 33.333 })], [line({ quantity: 2, unitAmount: 25 })]);
    expect(out.applied[0].awards[0].discountAmount).toBe(8.33);
  });

  test('a 0% reward costs nothing but still counts as applied', () => {
    const out = run([offer({ RewardPercent: 0 })], [line({ quantity: 2 })]);
    expect(out.applied[0].awards[0].discountAmount).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// A campaign's live state has to mean what the engine does.
//
// It did not: liveState checked the dates, the status and the budget, while the
// engine ALSO checked the weekday and the hour. So a weekends-only campaign read
// "Live" on a Tuesday, and a 00:05–00:05 window read "Live" all day while firing
// on no bill at all. A screen that says an offer is running when the till will
// refuse it is worse than one that says nothing.
const campaigns = require('../../modules/posoffer/campaign.service');

const active = (over = {}) => ({
  Status: 'ACTIVE', StartsOn: '2020-01-01', EndsOn: null,
  BudgetAmount: null, SpentAmount: 0, DaysOfWeek: null,
  StartTime: null, EndTime: null, ...over,
});
// 2026-08-25 is a Tuesday.
const TUE_NOON = new Date('2026-08-25T12:00:00');
const SAT_NOON = new Date('2026-08-29T12:00:00');

describe('when a campaign is actually live', () => {
  test('every day, all day', () => {
    expect(campaigns.liveState(active(), TUE_NOON)).toBe('LIVE');
  });

  test('weekends-only is NOT live on a Tuesday', () => {
    expect(campaigns.liveState(active({ DaysOfWeek: '6,7' }), TUE_NOON)).toBe('OFF_TODAY');
  });

  test('…and is on a Saturday', () => {
    expect(campaigns.liveState(active({ DaysOfWeek: '6,7' }), SAT_NOON)).toBe('LIVE');
  });

  test('outside its hours is not live', () => {
    const happyHour = active({ StartTime: '16:00:00', EndTime: '18:00:00' });
    expect(campaigns.liveState(happyHour, TUE_NOON)).toBe('OUTSIDE_HOURS');
    expect(campaigns.liveState(happyHour, new Date('2026-08-25T17:00:00'))).toBe('LIVE');
  });

  // 22:00–02:00 is a real late window, not a mistake.
  test('a window that crosses midnight still works', () => {
    const late = active({ StartTime: '22:00:00', EndTime: '02:00:00' });
    expect(campaigns.liveState(late, new Date('2026-08-25T23:00:00'))).toBe('LIVE');
    expect(campaigns.liveState(late, new Date('2026-08-25T01:00:00'))).toBe('LIVE');
    expect(campaigns.liveState(late, new Date('2026-08-25T12:00:00'))).toBe('OUTSIDE_HOURS');
  });

  // THE case that prompted this: a zero-length window displayed as Live.
  test('a zero-length window is never live', () => {
    expect(campaigns.liveState(active({ StartTime: '00:05:00', EndTime: '00:05:00' }), TUE_NOON))
      .toBe('OUTSIDE_HOURS');
  });

  // MySQL hands TIME back as HH:MM:SS; a form sends HH:MM. Both must compare.
  test('reads a time however it arrives', () => {
    expect(campaigns.liveState(active({ StartTime: '16:00', EndTime: '18:00' }),
      new Date('2026-08-25T17:00:00'))).toBe('LIVE');
  });

  // The earlier states still win, and in the right order.
  test.each([
    ['DRAFT', { Status: 'DRAFT' }, 'DRAFT'],
    ['PAUSED', { Status: 'PAUSED', DaysOfWeek: '6,7' }, 'PAUSED'],
    ['ENDED', { EndsOn: '2020-01-02' }, 'ENDED'],
    ['SCHEDULED', { StartsOn: '2099-01-01' }, 'SCHEDULED'],
    ['BUDGET_SPENT', { BudgetAmount: 100, SpentAmount: 100 }, 'BUDGET_SPENT'],
  ])('%s outranks the day and hour checks', (_l, over, expected) => {
    expect(campaigns.liveState(active(over), TUE_NOON)).toBe(expected);
  });
});

describe('a time window has to be able to contain a moment', () => {
  // Silently reinterpreting a zero-length window as "all day" would be guessing
  // at intent; refusing names the mistake while the form is still open.
  test('refuses the same start and end', () => {
    expect(() => campaigns.assertWindow({ StartTime: '00:05', EndTime: '00:05' }))
      .toThrow(/zero length/i);
  });

  test('refuses half a window', () => {
    expect(() => campaigns.assertWindow({ StartTime: '16:00', EndTime: null })).toThrow(/both/i);
    expect(() => campaigns.assertWindow({ StartTime: null, EndTime: '18:00' })).toThrow(/both/i);
  });

  test('allows a real window, and none at all', () => {
    expect(() => campaigns.assertWindow({ StartTime: '16:00', EndTime: '18:00' })).not.toThrow();
    expect(() => campaigns.assertWindow({ StartTime: '22:00', EndTime: '02:00' })).not.toThrow();
    expect(() => campaigns.assertWindow({ StartTime: null, EndTime: null })).not.toThrow();
  });

  test('compares HH:MM:SS against HH:MM', () => {
    expect(() => campaigns.assertWindow({ StartTime: '00:05:00', EndTime: '00:05' }))
      .toThrow(/zero length/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Rules that cannot fire, and carts that cannot be matched.
//
// Both used to report NOT_ENOUGH_ITEMS — "1 more needed" at a cart holding
// two. Sending somebody to add another cup of tea that will not help either is
// the worst kind of wrong answer: it looks actionable.
describe('an offer that would give everything away', () => {
  const sameItemBogo = (over = {}) => offer({
    TriggerMinQty: 1, RewardKind: 'SAME_ITEM', RewardQuantity: 1, ...over,
  });

  test('is reported as misconfigured, not as too few items', () => {
    const out = run([sameItemBogo()], [line({ quantity: 2 })]);
    expect(out.applied).toHaveLength(0);
    expect(out.skipped[0].reason).toBe(SKIP.MISCONFIGURED);
    expect(out.skipped[0].message).toMatch(/every qualifying item would be free/i);
    // …and names the fix.
    expect(out.skipped[0].message).toMatch(/trigger of 2 and a reward of 1/i);
  });

  // Spelling a same-item offer as SPECIFIC_ITEM pointing back at the trigger
  // used to bypass the floor entirely — which is exactly what somebody
  // building a BOGO does by accident.
  test('is caught even when spelled as a specific item', () => {
    const out = run([sameItemBogo({
      RewardKind: 'SPECIFIC_ITEM', RewardItemId: CHAI,
    })], [line({ quantity: 2 })]);
    expect(out.skipped[0].reason).toBe(SKIP.MISCONFIGURED);
  });

  // …while a SPECIFIC_ITEM reward on a DIFFERENT item is untouched.
  test('does not catch a genuine cross-sell', () => {
    const out = run([offer({
      TriggerMinQty: 1, RewardKind: 'SPECIFIC_ITEM', RewardItemId: JAMUN,
    })], [
      line({ ref: 'o1#0', itemId: CHAI, quantity: 1 }),
      line({ ref: 'o1#1', itemId: JAMUN, unitAmount: 25, quantity: 1 }),
    ]);
    expect(out.applied).toHaveLength(1);
  });

  test('and a properly written buy-two-get-one still fires', () => {
    expect(run([offer({ TriggerMinQty: 2 })], [line({ quantity: 2 })]).totalDiscount).toBe(25);
    expect(run([offer({ TriggerMinQty: 2, MaxPerBill: 9 })], [line({ quantity: 4 })]).totalDiscount).toBe(50);
  });
});

describe('a cart line with no catalogue item behind it', () => {
  test('is counted, so the caller can say what is actually wrong', () => {
    const out = run([offer()], [line({ itemId: null, categoryId: null, quantity: 2 })]);
    expect(out.unidentifiedLines).toBe(1);
  });

  test('and a properly identified cart reports none', () => {
    const out = run([offer()], [line({ quantity: 2 })]);
    expect(out.unidentifiedLines).toBe(0);
  });

  test('a line carrying only a category still counts as identified', () => {
    const out = run([offer()], [line({ itemId: null, categoryId: DESSERTS })]);
    expect(out.unidentifiedLines).toBe(0);
  });
});
