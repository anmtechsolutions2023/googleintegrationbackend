// Options & add-ons: which sell, on which dishes, and how often they are taken.
//
// Built from ORD-0001 as it really sold — a ₹239 Veg Triple Fried Rice with a
// Half portion, Raita and Paneer — scaled up to a week so the rates mean
// something. Every figure below can be checked by hand from the lines.

jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  captureAudit: jest.fn(),
}));

const mockConn = { execute: jest.fn() };
jest.mock('../../utils/dbHelper', () => ({
  withConnection: jest.fn(async (cb) => cb(mockConn)),
  withTransaction: jest.fn(async (cb) => cb(mockConn)),
}));

const { buildOptionsReport } = require('../../modules/ledger/ledger.options.report');
const reports = require('../../modules/ledger/ledger.report.service');

const HALF = { id: 'v-half', code: 'half', name: 'Half portion', price: 170 };
const FULL = { id: 'v-full', code: 'full', name: 'Full portion', price: 250 };
const RAITA = { id: 'a-raita', name: 'Raita', price: 20, groupId: 'g-dip', groupName: 'Extra dip', maxSelection: 1, minSelection: 0 };
const PANEER = { id: 'a-paneer', name: 'Paneer', price: 50, groupId: 'g-extra', groupName: 'Extra', maxSelection: 1, minSelection: 0 };
const CHICKEN = { id: 'a-chicken', name: 'Chicken', price: 80, groupId: 'g-extra', groupName: 'Extra', maxSelection: 1, minSelection: 0 };

// MySQL hands DECIMAL back as strings; the builder must not care.
const PRODUCTS = [
  { ItemId: 'rice', ItemName: 'Veg Triple Fried Rice', CategoryName: 'Special Fried Rice', QuantitySold: '26', OptionsAmount: '4630.0000', AddonsAmount: '680.0000', GrossAmount: '11524.00' },
  { ItemId: 'roll', ItemName: 'Chicken Spring Roll', CategoryName: 'Spring Rolls', QuantitySold: '12', OptionsAmount: '0', AddonsAmount: '100.0000', GrossAmount: '2488.00' },
  { ItemId: 'egg', ItemName: 'Egg Chilli', CategoryName: 'Non Veg Starter', QuantitySold: '22', OptionsAmount: '0', AddonsAmount: '0', GrossAmount: '4818.00' },
];

// Rice: 14 half + 9 full = 23 with an option, 3 plain (not in these lines).
// Paneer 6, Chicken 2, Raita 11 on rice; Raita 5 on the spring roll.
const LINES = [
  { ItemId: 'rice', Quantity: '6.0000', Variants: [HALF], Addons: [PANEER, RAITA] },
  { ItemId: 'rice', Quantity: '8.0000', Variants: [HALF], Addons: [] },
  { ItemId: 'rice', Quantity: '2.0000', Variants: [FULL], Addons: [CHICKEN, RAITA] },
  { ItemId: 'rice', Quantity: '3.0000', Variants: [FULL], Addons: [RAITA] },
  { ItemId: 'rice', Quantity: '4.0000', Variants: [FULL], Addons: null },
  // The JSON column can also arrive as text.
  { ItemId: 'roll', Quantity: '5.0000', Variants: '[]', Addons: JSON.stringify([RAITA]) },
];

const OFFERS = [
  { ItemId: 'rice', Kind: 'variant', OptionId: 'v-half' },
  { ItemId: 'rice', Kind: 'variant', OptionId: 'v-full' },
  { ItemId: 'rice', Kind: 'group', OptionId: 'g-extra' },
  { ItemId: 'rice', Kind: 'group', OptionId: 'g-dip' },
  { ItemId: 'roll', Kind: 'group', OptionId: 'g-dip' },
];

const report = () => buildOptionsReport(PRODUCTS, LINES, OFFERS);

describe('options — across the menu', () => {
  it('counts plates and the revenue each option added', () => {
    const { variants } = report();
    expect(variants.map((v) => v.Name)).toEqual(['Half portion', 'Full portion']);
    expect(variants[0]).toMatchObject({ Plates: 14, Revenue: 2380, Price: 170 });
    expect(variants[1]).toMatchObject({ Plates: 9, Revenue: 2250, Price: 250 });
  });

  it('takes the rate over the plates of dishes that offer the option', () => {
    const [half, full] = report().variants;
    expect(half).toMatchObject({ OfferedPlates: 26, TakeRate: 53.8 });
    expect(full).toMatchObject({ OfferedPlates: 26, TakeRate: 34.6 });
    expect(half.Dishes).toEqual([{ ItemId: 'rice', ItemName: 'Veg Triple Fried Rice', Plates: 14 }]);
  });
});

describe('add-on groups — across the menu', () => {
  it('counts a group once per plate, and each add-on on its own', () => {
    const extra = report().addonGroups.find((g) => g.GroupName === 'Extra');
    expect(extra).toMatchObject({ Plates: 8, Revenue: 460, OfferedPlates: 26, TakeRate: 30.8, MaxSelection: 1 });
    expect(extra.Addons.map((a) => [a.Name, a.Plates, a.Revenue, a.TakeRate])).toEqual([
      ['Paneer', 6, 300, 23.1],
      ['Chicken', 2, 160, 7.7],
    ]);
  });

  it('offers a group on every dish it is mapped to', () => {
    const dip = report().addonGroups.find((g) => g.GroupName === 'Extra dip');
    // 26 rice + 12 spring rolls; Raita went on 11 + 5 of them.
    expect(dip).toMatchObject({ Plates: 16, Revenue: 320, OfferedPlates: 38, TakeRate: 42.1 });
    expect(dip.Addons[0].Dishes).toEqual([
      { ItemId: 'rice', ItemName: 'Veg Triple Fried Rice', Plates: 11 },
      { ItemId: 'roll', ItemName: 'Chicken Spring Roll', Plates: 5 },
    ]);
  });

  it('two add-ons from one group on a plate are still one plate that took the group', () => {
    const multi = { ...PANEER, maxSelection: 2 };
    const r = buildOptionsReport(
      [{ ItemId: 'pizza', ItemName: 'Pizza', QuantitySold: '2', GrossAmount: '0' }],
      [{ ItemId: 'pizza', Quantity: 2, Variants: [], Addons: [multi, { ...CHICKEN, maxSelection: 2 }] }],
      [],
    );
    expect(r.addonGroups[0]).toMatchObject({ Plates: 2, Revenue: 260, TakeRate: 100 });
    expect(r.addonGroups[0].Addons.map((a) => a.Plates)).toEqual([2, 2]);
  });
});

describe('per dish — what the Products tab expands', () => {
  it('breaks one dish down, including the plates that took no option', () => {
    const rice = report().products.rice;
    expect(rice).toMatchObject({
      ItemName: 'Veg Triple Fried Rice', Plates: 26, PlatesWithoutOption: 3,
      GrossAmount: 11524, OptionsAmount: 4630, AddonsAmount: 680,
      OfferedVariantIds: ['v-half', 'v-full'], OfferedGroupIds: ['g-extra', 'g-dip'],
    });
    expect(rice.variants.map((v) => [v.Name, v.Plates, v.TakeRate])).toEqual([
      ['Half portion', 14, 53.8],
      ['Full portion', 9, 34.6],
    ]);
    const extra = rice.addonGroups.find((g) => g.GroupName === 'Extra');
    expect(extra).toMatchObject({ Plates: 8, TakeRate: 30.8 });
  });

  it('leaves out dishes that neither offer nor sold with a choice', () => {
    expect(report().products.egg).toBeUndefined();
    // A dish that offers only add-ons has no "without an option" figure.
    expect(report().products.roll.PlatesWithoutOption).toBeNull();
  });
});

describe('totals and history', () => {
  it('states options and add-ons as a share of revenue', () => {
    expect(report().totals).toEqual({
      OptionsAmount: 4630, AddonsAmount: 780, GrossAmount: 18830, Plates: 60, ShareOfRevenue: 28.7,
    });
  });

  it('a choice sold on a dish that no longer offers it still has an honest rate', () => {
    const r = buildOptionsReport(PRODUCTS, LINES, []);
    expect(r.variants[0]).toMatchObject({ OfferedPlates: 26, TakeRate: 53.8 });
    expect(r.variants.every((v) => v.TakeRate <= 100)).toBe(true);
  });

  it('reads an old snapshot that stored names only', () => {
    const r = buildOptionsReport(
      [{ ItemId: 'dosa', ItemName: 'Dosa', QuantitySold: '3', GrossAmount: '300' }],
      [{ ItemId: 'dosa', Quantity: '3', Variants: '["Large"]', Addons: 'not json' }],
      [],
    );
    expect(r.variants[0]).toMatchObject({ Name: 'Large', Plates: 3, Revenue: 0, VariantId: null });
    expect(r.addonGroups).toEqual([]);
  });

  it('an empty period is an empty report, not an error', () => {
    expect(buildOptionsReport([], [], [])).toEqual({
      totals: { OptionsAmount: 0, AddonsAmount: 0, GrossAmount: 0, Plates: 0, ShareOfRevenue: null },
      variants: [], addonGroups: [], products: {},
    });
  });
});

describe('the report endpoint', () => {
  const answer = () => mockConn.execute.mockImplementation(async (sql) => {
    const q = String(sql);
    if (/pos_item_meta_variant/.test(q)) return [OFFERS];
    if (/JSON_LENGTH/.test(q)) return [LINES];
    if (/AS OptionsAmount/.test(q)) return [PRODUCTS];
    return [[]];
  });

  beforeEach(() => mockConn.execute.mockReset());

  it('reads plates, option lines and offers on one connection', async () => {
    answer();
    const r = await reports.optionsReport({ preset: 'week' }, 'tn');
    expect(mockConn.execute).toHaveBeenCalledTimes(3);
    expect(r.variants[0]).toMatchObject({ Name: 'Half portion', Plates: 14 });
    expect(r.range).toBeDefined();
  });

  it('applies the same filters to both document reads', async () => {
    answer();
    await reports.optionsReport({ preset: 'week', branchId: 'br-1', categoryId: 'cat-1' }, 'tn');
    const [[plates, pParams], [lines, lParams]] = mockConn.execute.mock.calls;
    [plates, lines].forEach((sql) => {
      expect(sql).toMatch(/l\.BranchId = \?/);
      expect(sql).toMatch(/i\.CategoryId = \?/);
      expect(sql).toMatch(/s\.Name IN \('SETTLED', 'PARTIALLY_PAID'\)/);
      expect(sql).toMatch(/l\.ReversesLogId IS NULL/);
    });
    expect(pParams).toEqual(lParams);
    expect(pParams).toEqual(expect.arrayContaining(['tn', 'br-1', 'cat-1']));
  });

  it('asks which of the SOLD dishes offer each choice, binding the ids twice', async () => {
    answer();
    await reports.optionsReport({ preset: 'week' }, 'tn');
    const [sql, params] = mockConn.execute.mock.calls[2];
    expect(sql).not.toMatch(/:ids/);
    expect(params).toEqual(['tn', 'rice', 'roll', 'egg', 'tn', 'rice', 'roll', 'egg']);
  });

  it('skips the offers read when nothing sold', async () => {
    mockConn.execute.mockResolvedValue([[]]);
    const r = await reports.optionsReport({ preset: 'today' }, 'tn');
    expect(mockConn.execute).toHaveBeenCalledTimes(2);
    expect(r.variants).toEqual([]);
  });
});

describe('the product report carries what options and add-ons added', () => {
  it('sums the stored surcharges per unit times quantity, and returns numbers', async () => {
    mockConn.execute.mockReset();
    mockConn.execute.mockResolvedValue([[PRODUCTS[0]]]);
    const r = await reports.productReport({ preset: 'week' }, 'tn');
    const [sql] = mockConn.execute.mock.calls[0];
    expect(sql).toMatch(/SUM\(ti\.VariantAmount \* ti\.Quantity\)/);
    expect(sql).toMatch(/SUM\(ti\.AddonAmount \* ti\.Quantity\)/);
    expect(r.products[0]).toMatchObject({ OptionsAmount: 4630, AddonsAmount: 680, QuantitySold: 26 });
  });
});
