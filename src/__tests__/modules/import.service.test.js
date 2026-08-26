// Bulk import: a menu becomes a catalogue.
//
// The behaviour that matters most is the one that is easiest to get wrong and
// hardest to notice: an imported item must be an ORDINARY item. Everything else
// here — get-or-create, per-row isolation, duplicate policy — exists to stop a
// bad file costing more than the rows that were actually bad.

jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  captureAudit: jest.fn(),
}));

let state;
const executed = [];
const mockConn = {
  execute: jest.fn(async (sql, params) => {
    const s = String(sql);
    executed.push({ sql: s, params });
    if (/FROM itemdetail WHERE Name/.test(s)) return [state.existingItem ? [state.existingItem] : []];
    if (/FROM categorydetail WHERE Name/.test(s)) return [state.existingCategory ? [state.existingCategory] : []];
    if (/FROM UOM WHERE UnitName/.test(s)) return [state.existingUom ? [state.existingUom] : []];
    if (/FROM taxgroup WHERE Name/.test(s)) return [state.existingTaxGroup ? [state.existingTaxGroup] : []];
    if (/COUNT\(\*\) AS total FROM taxgrouptaxtypemapper/.test(s)) return [[{ total: state.taxTypeCount }]];
    if (/JOIN TaxTypes tt ON tt\.Id = m\.TaxTypeId/.test(s)) return [state.groupComponents];
    if (/FROM pos_item_meta WHERE ItemDetailId/.test(s)) return [state.existingMenuEntry ? [state.existingMenuEntry] : []];
    if (/FROM pos_food_type WHERE TenantId/.test(s)) return [state.foodTypes];
    if (/FROM TaxTypes WHERE Name/.test(s)) return [state.existingTaxType ? [state.existingTaxType] : []];
    if (/FROM taxgrouptaxtypemapper WHERE TaxGroupId/.test(s)) return [state.existingMapping ? [state.existingMapping] : []];
    return [{ affectedRows: 1 }];
  }),
};
jest.mock('../../utils/dbHelper', () => ({
  withConnection: async (cb) => cb(mockConn),
  withTransaction: async (cb) => cb(mockConn),
}));

// The composed services are mocked so this file tests the IMPORT's decisions,
// not the CRUD services it delegates to — those have their own suites.
const created = { categories: [], units: [], taxGroups: [], items: [], costInfos: [], menu: [],
  taxTypes: [], taxMaps: [] };
jest.mock('../../modules/category/category.service', () => ({
  createTx: jest.fn(async (c, d) => { created.categories.push(d.Name); return { id: 'cat-' + d.Name }; }),
}));
jest.mock('../../modules/uom/uom.service', () => ({
  createTx: jest.fn(async (c, d) => { created.units.push(d.UnitName); return { id: 'uom-' + d.UnitName }; }),
}));
jest.mock('../../modules/taxgroup/taxgroup.service', () => ({
  createTx: jest.fn(async (c, d) => { created.taxGroups.push(d.Name); return { id: 'tax-' + d.Name }; }),
}));
jest.mock('../../modules/costinfo/costinfo.service', () => ({
  createTx: jest.fn(async (c, d) => { created.costInfos.push(d); return { id: 'cost-' + d.Amount }; }),
}));
jest.mock('../../modules/itemdetail/itemdetail.service', () => ({
  createTx: jest.fn(async (c, d) => {
    if (d.Name === 'EXPLODE') throw new Error('Duplicate entry');
    created.items.push(d); return { id: 'item-' + d.Name };
  }),
  updateTx: jest.fn(async (c, id, d) => { created.items.push({ ...d, updated: true }); return { id }; }),
}));
jest.mock('../../modules/positemmeta/positemmeta.service', () => ({
  create: jest.fn(async (d) => { created.menu.push(d); return { id: 'meta-' + d.ItemDetailId }; }),
}));
jest.mock('../../modules/taxtype/taxtype.service', () => ({
  createTx: jest.fn(async (c, d) => { created.taxTypes.push(d); return { id: 'tt-' + d.Name }; }),
}));
jest.mock('../../modules/taxgrouptaxtypemapper/taxgrouptaxtypemapper.service', () => ({
  createTx: jest.fn(async (c, d) => { created.taxMaps.push(d); return { id: 'map' }; }),
}));

const service = require('../../modules/import/import.service');
const taxTypeService = require('../../modules/taxtype/taxtype.service');
const itemDetail = require('../../modules/itemdetail/itemdetail.service');
const itemMeta = require('../../modules/positemmeta/positemmeta.service');

const TENANT = 'tenant-a';
const USER = 'owner@crackd.in';

const row = (over = {}) => ({
  name: 'Mango Lassi', category: 'Lassi', unit: 'Glass',
  price: 80, taxGroup: 'GST 5%', taxIncluded: true, ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  executed.length = 0;
  Object.keys(created).forEach((k) => { created[k].length = 0; });
  state = {
    existingItem: null, existingCategory: null, existingUom: null,
    existingTaxGroup: null, existingMenuEntry: null,
    existingTaxType: null, existingMapping: null,
    // Exactly what provisionPosMasters seeds into every new tenancy.
    foodTypes: [
      { Id: 'ft-veg', Name: 'Veg', Code: 'VEG' },
      { Id: 'ft-vegan', Name: 'Vegan', Code: 'VEGAN' },
      { Id: 'ft-nonveg', Name: 'Non-Veg', Code: 'NONVEG' },
    ],
    // How many rates the named group already holds. 0 = empty, which is what a
    // freshly created group always is.
    taxTypeCount: 0,
    // The rates it holds, for the import's compare-don't-guess rule.
    groupComponents: [],
  };
});

describe('what an import writes', () => {
  // The requirement this whole design serves: an imported item is not a special
  // kind of item. It is written through the same createTx the ordinary form
  // calls, so it edits, re-prices and publishes like any other.
  it('creates items through the same service the form uses', async () => {
    await service.importItems([row()], {}, TENANT, USER);

    expect(itemDetail.createTx).toHaveBeenCalledTimes(1);
    const [, data] = itemDetail.createTx.mock.calls[0];
    expect(data).toMatchObject({
      Name: 'Mango Lassi',
      CategoryId: 'cat-Lassi',
      UOMId: 'uom-Glass',
      CostInfoId: 'cost-80',
      Active: true,
    });
    // No import-only marker of any kind — that is what keeps it ordinary.
    expect(Object.keys(data)).not.toContain('imported');
    expect(Object.keys(data)).not.toContain('ImportBatchId');
  });

  it('prices through cost info, carrying the tax group and inclusive flag', async () => {
    await service.importItems([row({ price: 119, taxIncluded: false })], {}, TENANT, USER);
    expect(created.costInfos[0]).toMatchObject({
      Amount: '119', TaxGroupId: 'tax-GST 5%', IsTaxIncluded: false,
    });
  });

  it('reports what it created', async () => {
    const res = await service.importItems([row(), row({ name: 'Rose Lassi' })], {}, TENANT, USER);
    expect(res.summary).toMatchObject({ total: 2, created: 2, failed: 0, skipped: 0 });
    expect(res.created).toMatchObject({ categories: 1, units: 1, taxGroups: 1 });
  });
});

describe('resolving the masters', () => {
  // 56 rows naming eight categories between them must produce eight categories.
  it('creates a category once, however many rows name it', async () => {
    await service.importItems(
      [row({ name: 'Plain Tea', category: 'Tea' }),
       row({ name: 'Ginger Tea', category: 'Tea' }),
       row({ name: 'Masala Tea', category: 'Tea' })],
      {}, TENANT, USER,
    );
    expect(created.categories).toEqual(['Tea']);
    expect(created.units).toEqual(['Glass']);
  });

  it('reuses one that already exists rather than colliding with it', async () => {
    state.existingCategory = { Id: 'cat-existing' };
    await service.importItems([row()], {}, TENANT, USER);
    expect(created.categories).toEqual([]);
    expect(itemDetail.createTx.mock.calls[0][1].CategoryId).toBe('cat-existing');
  });

  it('matches a name case-insensitively within one run', async () => {
    await service.importItems(
      [row({ name: 'A', category: 'Tea' }), row({ name: 'B', category: 'tea' })],
      {}, TENANT, USER,
    );
    expect(created.categories).toHaveLength(1);
  });
});

describe('a row that is already there', () => {
  beforeEach(() => { state.existingItem = { Id: 'item-old', Code: 'OLD', Description: null }; });

  // The default, and the safe one: a re-run at the wrong moment must not
  // silently reset prices somebody has since corrected by hand.
  it('is skipped by default, and left completely alone', async () => {
    const res = await service.importItems([row()], {}, TENANT, USER);

    expect(res.summary).toMatchObject({ skipped: 1, created: 0, updated: 0 });
    expect(res.rows[0].reason).toMatch(/already exists/i);
    expect(itemDetail.createTx).not.toHaveBeenCalled();
    expect(itemDetail.updateTx).not.toHaveBeenCalled();
  });

  it('is re-priced only when update is asked for explicitly', async () => {
    const res = await service.importItems([row({ price: 95 })], { onDuplicate: 'update' }, TENANT, USER);

    expect(res.summary).toMatchObject({ updated: 1, skipped: 0 });
    expect(itemDetail.updateTx).toHaveBeenCalled();
  });

  // A settled ledger line references the cost info it was priced from, so
  // rewriting that row in place would restate history.
  it('re-points at a NEW cost info rather than editing the old one', async () => {
    await service.importItems([row({ price: 95 })], { onDuplicate: 'update' }, TENANT, USER);
    const [, , data] = itemDetail.updateTx.mock.calls[0];
    expect(data.CostInfoId).toBe('cost-95');
    expect(created.costInfos).toHaveLength(1);
  });

  it('rejects an unknown duplicate policy by falling back to skip', async () => {
    const res = await service.importItems([row()], { onDuplicate: 'nonsense' }, TENANT, USER);
    expect(res.summary.skipped).toBe(1);
  });
});

describe('when a row goes wrong', () => {
  // The whole reason for one transaction per row: 55 good rows must survive.
  it('keeps every other row, and reports the one that failed', async () => {
    const res = await service.importItems(
      [row({ name: 'Plain Tea' }), row({ name: 'EXPLODE' }), row({ name: 'Rose Lassi' })],
      {}, TENANT, USER,
    );

    expect(res.summary).toMatchObject({ total: 3, created: 2, failed: 1 });
    expect(created.items.map((i) => i.Name)).toEqual(['Plain Tea', 'Rose Lassi']);

    const failed = res.rows.find((r) => r.status === 'failed');
    expect(failed).toMatchObject({ row: 2, name: 'EXPLODE' });
    expect(failed.reason).toMatch(/Duplicate entry/);
  });

  it('numbers rows from 1, the way the file is numbered', async () => {
    const res = await service.importItems([row({ name: 'A' }), row({ name: 'B' })], {}, TENANT, USER);
    expect(res.rows.map((r) => r.row)).toEqual([1, 2]);
  });
});

// The warning that only exists because of how this codebase behaves: a tax
// group with no tax types computes 0% and looks like a working setup.
describe('the empty tax group check', () => {
  it('flags a group that has no tax types mapped to it', async () => {
    state.existingTaxGroup = { Id: 'tax-1' };
    state.taxTypeCount = 0;
    await expect(service.findEmptyTaxGroups(['GST 5%'], TENANT)).resolves.toEqual(['GST 5%']);
  });

  it('says nothing about a group that is properly mapped', async () => {
    state.existingTaxGroup = { Id: 'tax-1' };
    state.taxTypeCount = 2;
    await expect(service.findEmptyTaxGroups(['GST 5%'], TENANT)).resolves.toEqual([]);
  });

  // A group the import is about to create cannot have types yet, so it counts.
  it('flags a group that does not exist yet', async () => {
    state.existingTaxGroup = null;
    await expect(service.findEmptyTaxGroups(['Brand New'], TENANT)).resolves.toEqual(['Brand New']);
  });
});

describe('publishing to a branch', () => {
  const publish = (over = {}) => service.importMenuEntries({
    branchDetailId: 'branch-1', defaultFoodType: 'VEG',
    channelIds: ['ch-1'], variantIds: [],
    items: [{ name: 'Mango Lassi' }], ...over,
  }, TENANT, USER);

  it('creates the menu entry through the ordinary service', async () => {
    state.existingItem = { Id: 'item-1' };
    const res = await publish();

    expect(res.summary).toMatchObject({ total: 1, created: 1 });
    expect(itemMeta.create).toHaveBeenCalledWith(
      expect.objectContaining({
        ItemDetailId: 'item-1', FoodTypeId: 'ft-veg',
        BranchDetailId: 'branch-1', ChannelIds: ['ch-1'],
      }), TENANT, USER,
    );
  });

  it('says so when the catalogue item is not there', async () => {
    state.existingItem = null;
    const res = await publish();
    expect(res.rows[0]).toMatchObject({ status: 'failed' });
    expect(res.rows[0].reason).toMatch(/No catalogue item/i);
  });

  // A re-run must report, not explode on UNIQUE (item, branch, tenant).
  it('skips an item already on that branch’s menu', async () => {
    state.existingItem = { Id: 'item-1' };
    state.existingMenuEntry = { Id: 'meta-1' };
    const res = await publish();
    expect(res.rows[0]).toMatchObject({ status: 'skipped' });
    expect(itemMeta.create).not.toHaveBeenCalled();
  });

  // FoodTypeId is NOT NULL, so without this the row dies at the constraint with
  // a message nobody can act on.
  // Naming what is wrong without saying what would be right just moves the
  // guessing somewhere else.
  it('explains an unknown food type, and names the ones that exist', async () => {
    state.existingItem = { Id: 'item-1' };
    const res = await publish({ defaultFoodType: 'PESCATARIAN' });
    expect(res.rows[0].reason).toMatch(/No food type matching/i);
    expect(res.rows[0].reason).toMatch(/Veg, Vegan, Non-Veg/);
    expect(itemMeta.create).not.toHaveBeenCalled();
  });
});

// The defect the sample CSV exposed: the row's own food type was parsed and
// then discarded, so every item on a mixed menu published as Veg.
describe('the food type a row asks for', () => {
  const publishOne = (foodType, over = {}) => {
    state.existingItem = { Id: 'item-1' };
    return service.importMenuEntries({
      branchDetailId: 'branch-1', defaultFoodType: 'VEG',
      items: [{ name: 'Chicken Roll', foodType }], ...over,
    }, TENANT, USER);
  };

  it('wins over the default — the bug this fixes', async () => {
    await publishOne('Non-Veg');
    expect(itemMeta.create.mock.calls[0][0].FoodTypeId).toBe('ft-nonveg');
  });

  // Every spelling of the value the template tells people to type.
  it.each([
    ['Non-Veg', 'ft-nonveg'], ['non veg', 'ft-nonveg'], ['NONVEG', 'ft-nonveg'],
    ['Non_Veg', 'ft-nonveg'], ['nonveg', 'ft-nonveg'], ['NON-VEG', 'ft-nonveg'],
    ['Veg', 'ft-veg'], ['veg', 'ft-veg'], ['VEG', 'ft-veg'],
    ['Vegan', 'ft-vegan'], ['vegan', 'ft-vegan'], ['VEGAN', 'ft-vegan'],
  ])('resolves %s', async (label, expected) => {
    await publishOne(label);
    expect(itemMeta.create.mock.calls[0][0].FoodTypeId).toBe(expected);
  });

  // Normalising must not turn a prefix into a match.
  it('does not confuse Veg with Vegan', async () => {
    await publishOne('Veg');
    expect(itemMeta.create.mock.calls[0][0].FoodTypeId).toBe('ft-veg');
    itemMeta.create.mockClear();
    await publishOne('Vegan');
    expect(itemMeta.create.mock.calls[0][0].FoodTypeId).toBe('ft-vegan');
  });

  it('falls back to the default only when the row says nothing', async () => {
    await publishOne(null, { defaultFoodType: 'Non-Veg' });
    expect(itemMeta.create.mock.calls[0][0].FoodTypeId).toBe('ft-nonveg');
  });

  // One query for the tenancy, however many rows are published.
  it('reads the food types once for the whole file', async () => {
    state.existingItem = { Id: 'item-1' };
    await service.importMenuEntries({
      branchDetailId: 'branch-1', defaultFoodType: 'VEG',
      items: [{ name: 'A' }, { name: 'B' }, { name: 'C' }],
    }, TENANT, USER);
    expect(executed.filter((e) => /FROM pos_food_type/.test(e.sql))).toHaveLength(1);
  });
});

// A tax group is a container; the rates live in TaxTypes mapped into it. The
// import used to create the group and stop, so "GST 5%" meant 5% to a human and
// 0% to the pricing engine — a menu that looked imported and charged nothing.
describe('giving a tax group its rates', () => {
  const withComponents = (components) => service.importItems(
    [row({ taxComponents: components })], {}, TENANT, USER,
  );

  it('creates the tax types the file states, and maps them in', async () => {
    await withComponents([{ name: 'CGST', value: '2.5' }, { name: 'SGST', value: '2.5' }]);

    expect(created.taxTypes).toEqual([
      { Name: 'CGST', Value: '2.5', Active: true },
      { Name: 'SGST', Value: '2.5', Active: true },
    ]);
    expect(created.taxMaps).toHaveLength(2);
    expect(created.taxMaps[0]).toMatchObject({ TaxGroupId: 'tax-GST 5%', TaxTypeId: 'tt-CGST' });
  });

  // The decision taken deliberately: a menu priced at 0% is the worse failure,
  // so a row that states no components gets the standard split rather than
  // nothing. The preview announces it; it is never silent.
  it('applies the 5% default when the row states none', async () => {
    await service.importItems([row()], {}, TENANT, USER);
    expect(created.taxTypes.map((t) => `${t.Name} ${t.Value}`)).toEqual(['CGST 2.5', 'SGST 2.5']);
    expect(created.taxMaps).toHaveLength(2);
  });

  it('lets a row override that default entirely', async () => {
    await withComponents([{ name: 'IGST', value: '5' }]);
    expect(created.taxTypes).toEqual([{ Name: 'IGST', Value: '5', Active: true }]);
    // The default is not bolted on alongside — that would double the tax.
    expect(created.taxTypes).toHaveLength(1);
  });

  it('reuses a tax type that already exists rather than duplicating it', async () => {
    state.existingTaxType = { Id: 'tt-existing' };
    await service.importItems([row()], {}, TENANT, USER);
    expect(created.taxTypes).toEqual([]);
    expect(created.taxMaps[0].TaxTypeId).toBe('tt-existing');
  });

  // There is no unique key on (group, type), so nothing else stops a second run
  // mapping the same rate in twice — which would double the tax on every item.
  it('does not map the same rate into the same group twice', async () => {
    state.existingTaxType = { Id: 'tt-existing' };
    state.existingMapping = { Id: 'map-existing' };
    await service.importItems([row()], {}, TENANT, USER);
    expect(created.taxMaps).toEqual([]);
  });

  it('creates each tax type once across the whole file', async () => {
    await service.importItems(
      [row({ name: 'A' }), row({ name: 'B' }), row({ name: 'C' })], {}, TENANT, USER,
    );
    expect(created.taxTypes.map((t) => t.Name)).toEqual(['CGST', 'SGST']);
  });

  it('counts what it created, so the caller can report it', async () => {
    const res = await service.importItems([row()], {}, TENANT, USER);
    expect(res.created).toMatchObject({ taxGroups: 1, taxTypes: 2, taxMappings: 2 });
  });
});

// The default fills a gap; it must never stack on top of rates that are already
// there. A group carrying IGST 5% would come out at 10%, and wrong tax is worse
// than none — none is visibly zero, wrong is plausible.
describe('the 5% default and an existing group', () => {
  it('fills a group that holds no rates', async () => {
    state.existingTaxGroup = { Id: 'tax-1' };
    state.taxTypeCount = 0;
    await service.importItems([row()], {}, TENANT, USER);
    expect(created.taxTypes.map((t) => t.Name)).toEqual(['CGST', 'SGST']);
  });

  // Your rule: a product that already has GST configured is not touched.
  it('leaves a group that already holds rates completely alone', async () => {
    state.existingTaxGroup = { Id: 'tax-1' };
    state.groupComponents = [{ Name: 'IGST', Value: '5' }];   // already 5%, one component
    const res = await service.importItems([row()], {}, TENANT, USER);

    expect(res.summary.created).toBe(1);      // the item still imports
    expect(created.taxTypes).toEqual([]);     // its tax is left exactly as it was
    expect(created.taxMaps).toEqual([]);
  });

  // Re-running the same file must be a no-op, not 56 failures — which means
  // "already configured, and it matches" has to be told apart from "already
  // configured, and you are asking for something else".
  it('is a no-op when the group already carries exactly those rates', async () => {
    state.existingTaxGroup = { Id: 'tax-1' };
    state.groupComponents = [{ Name: 'CGST', Value: '2.5' }, { Name: 'SGST', Value: '2.5' }];
    const res = await service.importItems(
      [row({ taxComponents: [{ name: 'CGST', value: '2.5' }, { name: 'SGST', value: '2.5' }] })],
      {}, TENANT, USER,
    );
    expect(res.summary.created).toBe(1);
    expect(created.taxTypes).toEqual([]);
  });

  it('matches regardless of the order the components are listed in', async () => {
    state.existingTaxGroup = { Id: 'tax-1' };
    state.groupComponents = [{ Name: 'SGST', Value: '2.5' }, { Name: 'CGST', Value: '2.5' }];
    const res = await service.importItems(
      [row({ taxComponents: [{ name: 'CGST', value: '2.5' }, { name: 'SGST', value: '2.5' }] })],
      {}, TENANT, USER,
    );
    expect(res.summary.created).toBe(1);
  });

  // Adding would stack to 10%; ignoring would make the column a lie. Neither.
  it('refuses when the file asks for rates the group does not carry', async () => {
    state.existingTaxGroup = { Id: 'tax-1' };
    state.groupComponents = [{ Name: 'CGST', Value: '2.5' }, { Name: 'SGST', Value: '2.5' }];
    const res = await service.importItems(
      [row({ taxComponents: [{ name: 'IGST', value: '5' }] })], {}, TENANT, USER,
    );
    expect(res.summary.failed).toBe(1);
    expect(res.rows[0].reason).toMatch(/already carries different rates/i);
    expect(created.taxTypes).toEqual([]);
  });
});

// A file that asks for one group two different ways. Which one the operator
// meant is not something to guess at.
describe('a file that contradicts itself', () => {
  it('refuses the row that disagrees, and keeps the one that came first', async () => {
    const res = await service.importItems([
      row({ name: 'Plain Tea' }),                                             // default
      row({ name: 'Mango Lassi', taxComponents: [{ name: 'IGST', value: '5' }] }),
    ], {}, TENANT, USER);

    expect(res.summary).toMatchObject({ created: 1, failed: 1 });
    expect(res.rows[1].reason).toMatch(/two different sets of rates/i);
    // Only the first row's rates were written — no stacking.
    expect(created.taxTypes.map((t) => t.Name)).toEqual(['CGST', 'SGST']);
  });

  it('allows the same rates stated two ways — explicit and by omission', async () => {
    const res = await service.importItems([
      row({ name: 'Plain Tea' }),
      row({ name: 'Mango Lassi',
        taxComponents: [{ name: 'CGST', value: '2.5' }, { name: 'SGST', value: '2.5' }] }),
    ], {}, TENANT, USER);

    expect(res.summary).toMatchObject({ created: 2, failed: 0 });
    expect(created.taxTypes.map((t) => t.Name)).toEqual(['CGST', 'SGST']);
  });

  it('lets two different groups carry different rates, as they should', async () => {
    const res = await service.importItems([
      row({ name: 'Plain Tea', taxGroup: 'GST 5%' }),
      row({ name: 'Imported Beans', taxGroup: 'IGST 5%',
        taxComponents: [{ name: 'IGST', value: '5' }] }),
    ], {}, TENANT, USER);
    expect(res.summary).toMatchObject({ created: 2, failed: 0 });
  });
});
