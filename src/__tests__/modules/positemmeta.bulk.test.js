// Menu Master's bulk update: one change for many dishes, all or nothing.

jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  captureAudit: jest.fn(),
}));
jest.mock('uuid', () => ({ v4: jest.fn(() => 'new-link') }));

const mockConn = { execute: jest.fn() };
jest.mock('../../utils/dbHelper', () => ({
  withTransaction: jest.fn(async (cb) => cb(mockConn)),
  withConnection: jest.fn(async (cb) => cb(mockConn)),
  executeQuery: jest.fn(),
}));

const service = require('../../modules/positemmeta/positemmeta.service');
const { bulkUpdateSchema } = require('../../modules/positemmeta/positemmeta.schemas');

const A = 'aaaaaaaa-0000-4000-8000-000000000001';
const B = 'aaaaaaaa-0000-4000-8000-000000000002';
const C = 'aaaaaaaa-0000-4000-8000-000000000003';
const CHINESE = 'bbbbbbbb-0000-4000-8000-000000000001';
const STARTER = 'bbbbbbbb-0000-4000-8000-000000000002';

const TARGETS = [
  { Id: A, Active: 1, ItemName: 'Chicken Kabab With Bones - 2 Pcs' },
  { Id: B, Active: 1, ItemName: 'Gobi Manchurian' },
  { Id: C, Active: 0, ItemName: 'Lemon Chicken' },
];

const route = ({ targets = TARGETS, links = {} } = {}) => {
  mockConn.execute.mockImplementation(async (sql, params = []) => {
    const q = String(sql);
    // The rows that exist, of the ids asked for.
    if (/FROM pos_item_meta im/.test(q)) return [targets.filter((t) => params.includes(t.Id))];
    const link = q.match(/FROM (pos_item_meta_\w+) WHERE TenantId = \? AND ItemMetaId IN/);
    if (link) return [links[link[1]] || []];
    return [{ affectedRows: 1 }];
  });
};
const calls = (re) => mockConn.execute.mock.calls.filter(([sql]) => re.test(String(sql)));

beforeEach(() => mockConn.execute.mockReset());

describe('turning dishes off and on', () => {
  it('is one UPDATE for every selected dish', async () => {
    route();
    const result = await service.bulkUpdate([A, B, C], { Active: false }, 'tn', 'u');

    const [update] = calls(/^UPDATE pos_item_meta SET/);
    expect(update[0]).toMatch(/SET Active = \?, UpdatedOn = NOW\(\), UpdatedBy = \? WHERE TenantId = \? AND Id IN \(\?, \?, \?\)/);
    expect(update[1]).toEqual([0, 'u', 'tn', A, B, C]);
    expect(calls(/^UPDATE pos_item_meta SET/)).toHaveLength(1);
    expect(result).toEqual({
      updated: 3,
      items: TARGETS.map((t) => ({ Id: t.Id, ItemName: t.ItemName, Active: 0 })),
    });
  });

  it('refuses the whole change when a selected dish no longer exists', async () => {
    route({ targets: TARGETS.slice(0, 2) });
    await expect(service.bulkUpdate([A, B, C], { Active: false }, 'tn', 'u'))
      .rejects.toMatchObject({ statusCode: 404, message: expect.stringMatching(/1 of the selected items no longer exist/) });
    expect(calls(/^UPDATE|^DELETE|^INSERT/)).toHaveLength(0);
  });

  it('sets several plain fields together, and clears an optional one', async () => {
    route();
    await service.bulkUpdate([A, B], { FoodTypeId: CHINESE, MeatTypeId: null, PrepTimeMinutes: 15 }, 'tn', 'u');
    const [[sql, params]] = calls(/^UPDATE pos_item_meta SET/);
    expect(sql).toMatch(/SET FoodTypeId = \?, MeatTypeId = \?, PrepTimeMinutes = \?, UpdatedOn/);
    expect(params.slice(0, 3)).toEqual([CHINESE, null, 15]);
  });
});

describe('link fields', () => {
  it('add keeps what each dish has, and skips the dishes that already have it', async () => {
    route({ links: { pos_item_meta_tag: [
      { ItemMetaId: A, LinkId: STARTER },
      { ItemMetaId: B, LinkId: CHINESE },
    ] } });
    await service.bulkUpdate([A, B], { TagIds: { mode: 'add', ids: [CHINESE] } }, 'tn', 'u');

    expect(calls(/^DELETE FROM pos_item_meta_tag/).map(([, p]) => p[0])).toEqual([A]);
    expect(calls(/^INSERT INTO pos_item_meta_tag/).map(([, p]) => p[2])).toEqual([STARTER, CHINESE]);
    // No scalar column changed, so no row UPDATE.
    expect(calls(/^UPDATE pos_item_meta SET/)).toHaveLength(0);
  });

  it('remove drops only the listed links', async () => {
    route({ links: { pos_item_meta_channel: [
      { ItemMetaId: A, LinkId: CHINESE }, { ItemMetaId: A, LinkId: STARTER },
    ] } });
    await service.bulkUpdate([A, B], { ChannelIds: { mode: 'remove', ids: [CHINESE] } }, 'tn', 'u');
    expect(calls(/^DELETE FROM pos_item_meta_channel/).map(([, p]) => p[0])).toEqual([A]);
    expect(calls(/^INSERT INTO pos_item_meta_channel/).map(([, p]) => p[2])).toEqual([STARTER]);
  });

  it('replace sets exactly the given links on every dish', async () => {
    route({ links: { pos_item_meta_variant: [{ ItemMetaId: A, LinkId: STARTER }] } });
    await service.bulkUpdate([A, B], { VariantIds: { mode: 'replace', ids: [CHINESE] } }, 'tn', 'u');
    expect(calls(/^DELETE FROM pos_item_meta_variant/).map(([, p]) => p[0])).toEqual([A, B]);
  });

  it('adding an add-on group appends it after the dish\'s existing order', async () => {
    route({ links: { pos_item_meta_addon_group: [{ ItemMetaId: A, LinkId: STARTER }] } });
    await service.bulkUpdate([A], { AddonGroupIds: { mode: 'add', ids: [CHINESE] } }, 'tn', 'u');
    const inserts = calls(/^INSERT INTO pos_item_meta_addon_group/).map(([, p]) => [p[2], p[3]]);
    expect(inserts).toEqual([[STARTER, 0], [CHINESE, 1]]);
  });

  it('applyListChange keeps order and never duplicates', () => {
    expect(service.applyListChange(['x', 'y'], { mode: 'add', ids: ['y', 'z'] })).toEqual(['x', 'y', 'z']);
    expect(service.applyListChange(['x', 'y'], { mode: 'remove', ids: ['x'] })).toEqual(['y']);
    expect(service.applyListChange(['x'], { mode: 'replace', ids: ['z', 'z'] })).toEqual(['z']);
  });
});

describe('what the endpoint accepts', () => {
  const check = (body) => bulkUpdateSchema.validate(body);

  it('a turn-off', () => {
    expect(check({ ids: [A, B], changes: { Active: false } }).error).toBeUndefined();
  });

  it('refuses no ids, no changes, a repeated id or an unknown mode', () => {
    expect(check({ ids: [], changes: { Active: false } }).error).toBeDefined();
    expect(check({ ids: [A], changes: {} }).error).toBeDefined();
    expect(check({ ids: [A, A], changes: { Active: false } }).error).toBeDefined();
    expect(check({ ids: [A], changes: { TagIds: { mode: 'merge', ids: [CHINESE] } } }).error).toBeDefined();
  });

  it('refuses fields a bulk change may not touch', () => {
    expect(check({ ids: [A], changes: { CostInfoId: CHINESE } }).error).toBeDefined();
    expect(check({ ids: [A], changes: { BranchDetailId: CHINESE } }).error).toBeDefined();
    expect(check({ ids: [A], changes: { ItemDetailId: CHINESE } }).error).toBeDefined();
  });

  it('a required food type cannot be cleared; an optional meat type and prep time can', () => {
    expect(check({ ids: [A], changes: { FoodTypeId: null } }).error).toBeDefined();
    const { error, value } = check({ ids: [A], changes: { MeatTypeId: '', PrepTimeMinutes: '' } });
    expect(error).toBeUndefined();
    expect(value.changes).toEqual({ MeatTypeId: null, PrepTimeMinutes: null });
  });
});
