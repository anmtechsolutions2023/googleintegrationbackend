// A closed section refuses the line.
//
// Greying the card on the till is presentation: a till left open since
// breakfast still holds a live token and can still POST the line. The rule has
// to be re-applied where the order is actually created, from live data — the
// same discipline settle uses for campaign offers.

jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  captureAudit: jest.fn(),
}));
jest.mock('uuid', () => ({ v4: jest.fn(() => 'mock-uuid') }));
jest.mock('../../utils/dbHelper', () => ({
  withConnection: jest.fn(), withTransaction: jest.fn(), executeQuery: jest.fn(),
}));
jest.mock('../../modules/positemmeta/positemmeta.repository', () => ({
  getInactiveItemMetaIds: jest.fn(async () => new Set()),
  getCostInfoIdsByItemMetaIds: jest.fn(async () => new Map()),
  getVariantPricesByIds: jest.fn(async () => new Map()),
  getAddonPricesByIds: jest.fn(async () => new Map()),
  getAddonRulesByItemMetaIds: jest.fn(async () => new Map()),
  getCategoryIdsByItemMetaIds: jest.fn(),
}));
jest.mock('../../modules/poscategoryschedule/poscategoryschedule.service', () => {
  const actual = jest.requireActual('../../modules/poscategoryschedule/poscategoryschedule.service');
  return {
    // The RULE stays real — this suite is about whether the order path applies
    // it, not about re-testing the rule.
    availabilityOf: actual.availabilityOf,
    indexByCategory: actual.indexByCategory,
    getAllForTenant: jest.fn(),
    getTimeZone: jest.fn(async () => 'Asia/Kolkata'),
  };
});

const repo = require('../../modules/positemmeta/positemmeta.repository');
const schedule = require('../../modules/poscategoryschedule/poscategoryschedule.service');
const service = require('../../modules/posorder/posorder.service');

const TENANT = 'tn';
const BREAKFAST = 'cat-breakfast';
const ALLDAY = 'cat-allday';

// 15:00 Asia/Kolkata — after a 07:00-11:00 window, before an 18:00 one.
const AFTERNOON = new Date('2026-09-11T09:30:00Z');

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers().setSystemTime(AFTERNOON);
  repo.getCategoryIdsByItemMetaIds.mockResolvedValue(new Map([
    ['m-poha', BREAKFAST],
    ['m-dosa', BREAKFAST],
    ['m-rice', ALLDAY],
  ]));
  schedule.getAllForTenant.mockResolvedValue([
    // Every weekday, so the assertion does not depend on which day it runs.
    ...[0, 1, 2, 3, 4, 5, 6].map((d) => ({
      CategoryId: BREAKFAST, DayOfWeek: d, StartTime: '07:00:00', EndTime: '11:00:00',
    })),
  ]);
});

afterEach(() => jest.useRealTimers());

const assert = (items) => service.assertLinesAreOnMenu
  ? service.assertLinesAreOnMenu(items, TENANT)
  : Promise.reject(new Error('assertLinesAreOnMenu is not exported'));

describe('ordering outside a section\'s hours', () => {
  it('refuses a dish whose section is shut', async () => {
    await expect(assert([{ id: 'm-poha', name: 'Poha', qty: 1 }]))
      .rejects.toThrow(/Not on the menu right now/i);
  });

  it('names the dish and when it comes back, not just "unavailable"', async () => {
    await expect(assert([{ id: 'm-poha', name: 'Poha', qty: 1 }]))
      .rejects.toThrow(/Poha \(back at 07:00\)/);
  });

  it('lets a section with no rules through', async () => {
    await expect(assert([{ id: 'm-rice', name: 'Fried Rice', qty: 1 }])).resolves.toBeUndefined();
  });

  it('refuses the whole round when one line is shut', async () => {
    await expect(assert([
      { id: 'm-rice', name: 'Fried Rice', qty: 1 },
      { id: 'm-poha', name: 'Poha', qty: 1 },
    ])).rejects.toThrow(/Poha/);
  });

  it('lists every shut line, so the cashier fixes the cart once', async () => {
    await expect(assert([
      { id: 'm-poha', name: 'Poha', qty: 1 },
      { id: 'm-dosa', name: 'Masala Dosa', qty: 1 },
    ])).rejects.toThrow(/Poha.*Masala Dosa/);
  });

  it('allows everything while the window is open', async () => {
    // 09:00 Asia/Kolkata, inside 07:00-11:00.
    jest.setSystemTime(new Date('2026-09-11T03:30:00Z'));
    await expect(assert([{ id: 'm-poha', name: 'Poha', qty: 1 }])).resolves.toBeUndefined();
  });

  // An uncategorised dish is still sellable — the same default the rest of the
  // feature rests on, applied at the other end.
  it('lets a line with no category through', async () => {
    repo.getCategoryIdsByItemMetaIds.mockResolvedValue(new Map([['m-x', null]]));
    await expect(assert([{ id: 'm-x', name: 'Odd one', qty: 1 }])).resolves.toBeUndefined();
  });

  it('asks nothing of the database for an empty cart', async () => {
    await expect(assert([])).resolves.toBeUndefined();
    expect(repo.getCategoryIdsByItemMetaIds).not.toHaveBeenCalled();
  });

  it('judges the whole cart at ONE instant', async () => {
    await expect(assert([
      { id: 'm-poha', name: 'Poha', qty: 1 },
      { id: 'm-dosa', name: 'Masala Dosa', qty: 1 },
    ])).rejects.toThrow();
    // One read of the rules for the cart, not one per line.
    expect(schedule.getAllForTenant).toHaveBeenCalledTimes(1);
    expect(repo.getCategoryIdsByItemMetaIds).toHaveBeenCalledTimes(1);
  });
});

describe('a dish turned off in Menu Master', () => {
  it('is refused even though its section is open', async () => {
    repo.getInactiveItemMetaIds.mockResolvedValueOnce(new Set(['m-rice']));
    await expect(assert([{ id: 'm-rice', name: 'Veg Fried Rice', qty: 1 }]))
      .rejects.toThrow('Not on sale: Veg Fried Rice.');
  });

  it('says "not on sale", never an opening time, when its section is shut too', async () => {
    repo.getInactiveItemMetaIds.mockResolvedValueOnce(new Set(['m-poha']));
    const err = await assert([{ id: 'm-poha', name: 'Poha', qty: 1 }]).catch((e) => e);
    expect(err.message).toBe('Not on sale: Poha.');
  });

  it('names both problems when a cart has one of each', async () => {
    repo.getInactiveItemMetaIds.mockResolvedValueOnce(new Set(['m-rice']));
    const err = await assert([
      { id: 'm-rice', name: 'Veg Fried Rice', qty: 1 },
      { id: 'm-poha', name: 'Poha', qty: 1 },
    ]).catch((e) => e);
    expect(err.statusCode).toBe(400);
    expect(err.message).toBe('Not on sale: Veg Fried Rice. Not on the menu right now: Poha (back at 07:00).');
  });

  it('a dish that is on sale in an open section still goes through', async () => {
    await expect(assert([{ id: 'm-rice', name: 'Veg Fried Rice', qty: 1 }])).resolves.toBeUndefined();
  });
});

