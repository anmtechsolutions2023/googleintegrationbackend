// src/__tests__/modules/menu.import.test.js
// The menu file's rules, row by row: a blank cell keeps, "-" clears, a new
// dish goes everywhere, prices per branch and per portal, and names that may
// never be created from a file.

jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  captureAudit: jest.fn(),
}));

const { QUERIES } = require('../../config/constants');
const m = require('../../modules/menu/menu.masters');
const { mergeRow, normaliseRow, parseVariants, parseDays, describeChanges } = require('../../modules/menu/menu.import');

const BRANCHES = [{ Id: 'b-ind', Name: 'Indiranagar' }, { Id: 'b-kor', Name: 'Koramangala' }];
const CHANNELS = [{ Id: 'c-dine', Name: 'Dine In', Code: 'DINEIN' }, { Id: 'c-take', Name: 'Takeaway', Code: 'TAKEAWAY' }, { Id: 'c-online', Name: 'Online', Code: 'ONLINE' }];
const PORTALS = [{ Id: 'p-zom', Name: 'Zomato', Code: 'ZOMATO', ChannelId: 'c-online' }];
const refs = { branches: BRANCHES, channels: CHANNELS, portals: PORTALS };

const conn = {
  execute: jest.fn(async (sql) => {
    if (sql === QUERIES.MENU.BRANCHES) return [BRANCHES];
    if (sql === QUERIES.MENU.CHANNELS) return [CHANNELS];
    if (sql === QUERIES.MENU.PORTALS) return [PORTALS];
    return [[]];
  }),
};
const ctx = () => m.newContext('tenant-1', 'user');
const row = (o) => normaliseRow(o);

const EXISTING = () => ({
  itemId: 'item-1', code: 'MNS-02', name: 'Veg Biryani', category: 'Mains', description: 'Basmati',
  diet: 'Veg', meatType: null, unit: 'Plate', sku: null, barcode: null, hsn: null, sac: '996331',
  price: 180, taxGroup: 'GST 5%', taxComponents: [{ name: 'CGST', value: '2.5' }, { name: 'SGST', value: '2.5' }],
  taxIncluded: false,
  branches: [{ branchId: 'b-ind', channelIds: ['c-dine', 'c-take'], price: null }],
  variants: [{ name: 'Regular', surcharge: 0 }, { name: 'Large', surcharge: 60 }],
  addonGroups: ['Toppings'], tags: ['Main Course'],
  serves: 1, portion: '500 g', prepMin: 25, maxPerOrder: 4, stockTracked: true,
  nutrition: null, portals: [], status: 'Active', hasPhoto: false,
});

describe('menu file — a row laid over a dish', () => {
  it('a blank cell keeps the value; only what the row says changes', async () => {
    const after = await mergeRow(conn, ctx(), EXISTING(), row({ code: 'MNS-02', name: '', price: '200', tags: '' }), refs);
    expect(after.name).toBe('Veg Biryani');
    expect(after.price).toBe(200);
    expect(after.tags).toEqual(['Main Course']);
    expect(after.variants).toHaveLength(2);
  });

  it('a single "-" clears it', async () => {
    const after = await mergeRow(conn, ctx(), EXISTING(), row({ description: '-', addon_groups: '-', max_per_order: '-' }), refs);
    expect(after.description).toBeNull();
    expect(after.addonGroups).toEqual([]);
    expect(after.maxPerOrder).toBeNull();
  });

  it('a new dish goes on every branch and every channel unless the row says otherwise', async () => {
    const after = await mergeRow(conn, ctx(), null, row({ name: 'Masala Dosa', category: 'Breakfast', diet: 'Veg', unit: 'Plate', price: '120' }), refs);
    expect(after.branches.map((b) => b.branchId)).toEqual(['b-ind', 'b-kor']);
    expect(after.branches[0].channelIds).toEqual(['c-dine', 'c-take', 'c-online']);
    expect(after.status).toBe('Active');
  });

  it('reads branches and channels by name, and a branch price by its column', async () => {
    const after = await mergeRow(conn, ctx(), EXISTING(), row({
      branches: 'Indiranagar; Koramangala', channels: 'Dine In; Takeaway', 'price@Koramangala': '190',
    }), refs);
    expect(after.branches).toEqual([
      { branchId: 'b-ind', channelIds: ['c-dine', 'c-take'], price: null },
      { branchId: 'b-kor', channelIds: ['c-dine', 'c-take'], price: 190 },
    ]);
  });

  it('never creates a channel or branch from a file', async () => {
    await expect(mergeRow(conn, ctx(), EXISTING(), row({ channels: 'Delivary' }), refs))
      .rejects.toThrow(/Channel “Delivary” doesn't exist/);
    await expect(mergeRow(conn, ctx(), EXISTING(), row({ branches: 'Whitefield' }), refs))
      .rejects.toThrow(/Branch “Whitefield” doesn't exist/);
  });

  it('reads portal columns by the portal\'s name, and a price alone lists it', async () => {
    const after = await mergeRow(conn, ctx(), EXISTING(), row({ zomato_price: '210', zomato_name: 'Veg Dum Biryani' }), refs);
    expect(after.portals).toEqual([{ portalId: 'p-zom', listed: true, price: 210, name: 'Veg Dum Biryani' }]);
    const off = await mergeRow(conn, ctx(), after, row({ zomato_listed: 'No' }), refs);
    expect(off.portals[0].listed).toBe(false);
  });

  it('reads Hidden and Active, and refuses anything else', async () => {
    expect((await mergeRow(conn, ctx(), EXISTING(), row({ status: 'Hidden' }), refs)).status).toBe('Hidden');
    await expect(mergeRow(conn, ctx(), EXISTING(), row({ status: 'Sometimes' }), refs)).rejects.toThrow(/Active or Hidden/);
  });

  it('touches only the nutrition values the row gives', async () => {
    const after = await mergeRow(conn, ctx(), EXISTING(), row({ kcal: '520', allergens: 'Dairy' }), refs);
    expect(after.nutrition).toMatchObject({ Calories: 520, Allergens: 'Dairy', ProteinG: null });
  });

  it('accepts the old item template\'s columns (food_type, tax_components)', async () => {
    const after = await mergeRow(conn, ctx(), null, row({
      name: 'Plain Tea', category: 'Tea', unit: 'Glass', price: '15', tax_group: 'GST 5%',
      tax_components: 'CGST:2.5|SGST:2.5', food_type: 'Veg', tax_included: 'true',
    }), refs);
    expect(after.diet).toBe('Veg');
    expect(after.taxIncluded).toBe(true);
    expect(after.taxComponents).toEqual([{ name: 'CGST', value: '2.5' }, { name: 'SGST', value: '2.5' }]);
  });

  it('says what a bad number is, against its column', async () => {
    await expect(mergeRow(conn, ctx(), EXISTING(), row({ price: 'free' }), refs)).rejects.toThrow(/Price should be a number/);
  });
});

describe('menu file — cell formats', () => {
  it('reads variants with their extra price', () => {
    expect(parseVariants('Regular=0; Large=+60; Family')).toEqual([
      { name: 'Regular', surcharge: 0 }, { name: 'Large', surcharge: 60 }, { name: 'Family', surcharge: 0 },
    ]);
  });

  it('reads day ranges, lists and every day (0 = Sunday)', () => {
    expect(parseDays('Mon-Fri')).toEqual([1, 2, 3, 4, 5]);
    expect(parseDays('Sat; Sun')).toEqual([6, 0]);
    expect(parseDays('Fri-Mon')).toEqual([5, 6, 0, 1]);
    expect(parseDays('Every day')).toHaveLength(7);
    expect(() => parseDays('Weekdays')).toThrow(/Mon-Fri/);
  });

  it('reads tax rates in the importer\'s notation, and refuses a malformed one', () => {
    expect(m.parseTaxComponents('cgst:2.5|sgst:2.50')).toEqual([{ name: 'CGST', value: '2.5' }, { name: 'SGST', value: '2.5' }]);
    expect(() => m.parseTaxComponents('CGST 2.5')).toThrow(/CGST:2.5/);
  });
});

describe('menu file — the review', () => {
  it('lists each change in words, and ignores tag order', () => {
    const before = EXISTING();
    const after = { ...EXISTING(), price: 200, tags: ['Main Course'], variants: [{ name: 'Regular', surcharge: 0 }, { name: 'Large', surcharge: 70 }] };
    const changes = describeChanges(before, after, refs);
    expect(changes).toEqual(expect.arrayContaining([
      { field: 'Price', from: '₹180', to: '₹200' },
      { field: 'Variants', from: 'Regular +0; Large +60', to: 'Regular +0; Large +70' },
    ]));
    const reordered = describeChanges({ ...EXISTING(), tags: ['B', 'A'] }, { ...EXISTING(), tags: ['A', 'B'] }, refs);
    expect(reordered).toEqual([]);
  });
});
