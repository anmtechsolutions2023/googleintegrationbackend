// src/__tests__/modules/pricing.repository.test.js
// Covers the two things the repository is responsible for: safe id binding and
// folding the flat join result into one entry per costinfo.

const mockConn = { execute: jest.fn(), release: jest.fn() };

jest.mock('../../utils/dbHelper', () => ({
  withConnection: jest.fn(async (cb) => cb(mockConn)),
}));

const repository = require('../../modules/pricing/pricing.repository');

const TENANT = 'tenant-1';

afterEach(() => jest.clearAllMocks());

describe('expandIdPlaceholders', () => {
  it('emits one bind placeholder per id', () => {
    expect(repository.expandIdPlaceholders('IN (:ids)', 3)).toBe('IN (?, ?, ?)');
  });

  it('never interpolates values into the SQL', () => {
    // Ids travel as bound params; only the COUNT of ? is generated.
    const sql = repository.expandIdPlaceholders('IN (:ids)', 1);
    expect(sql).toBe('IN (?)');
    expect(sql).not.toMatch(/'/);
  });
});

describe('groupChainRows', () => {
  it('folds multiple tax-type rows into one costinfo entry', () => {
    const grouped = repository.groupChainRows([
      { CostInfoId: 'ci1', Amount: '100', IsTaxIncluded: 0, TaxGroupId: 'tg1', TaxGroupName: 'GST18', TaxTypeId: 'c1', TaxTypeName: 'CGST', TaxTypeValue: '9' },
      { CostInfoId: 'ci1', Amount: '100', IsTaxIncluded: 0, TaxGroupId: 'tg1', TaxGroupName: 'GST18', TaxTypeId: 's1', TaxTypeName: 'SGST', TaxTypeValue: '9' },
    ]);
    expect(grouped.size).toBe(1);
    expect(grouped.get('ci1').components).toHaveLength(2);
    expect(grouped.get('ci1').taxGroupName).toBe('GST18');
  });

  it('separates distinct costinfos', () => {
    const grouped = repository.groupChainRows([
      { CostInfoId: 'ci1', Amount: '100', IsTaxIncluded: 0, TaxTypeId: 'c1', TaxTypeName: 'CGST', TaxTypeValue: '9' },
      { CostInfoId: 'ci2', Amount: '50', IsTaxIncluded: 1, TaxTypeId: 'c1', TaxTypeName: 'CGST', TaxTypeValue: '9' },
    ]);
    expect(grouped.size).toBe(2);
    expect(grouped.get('ci2').isTaxIncluded).toBe(true);
  });

  it('treats a LEFT JOIN null tax type as an exempt group, not a component', () => {
    // A costinfo whose group has no active types still returns one row.
    const grouped = repository.groupChainRows([
      { CostInfoId: 'ci1', Amount: '100', IsTaxIncluded: 0, TaxGroupId: 'tg2', TaxGroupName: 'Exempt', TaxTypeId: null, TaxTypeName: null, TaxTypeValue: null },
    ]);
    expect(grouped.get('ci1').components).toEqual([]);
    expect(grouped.get('ci1').taxGroupName).toBe('Exempt');
  });

  it('maps TINYINT 1/0 to a real boolean', () => {
    const grouped = repository.groupChainRows([
      { CostInfoId: 'a', Amount: '1', IsTaxIncluded: 1, TaxTypeId: null },
      { CostInfoId: 'b', Amount: '1', IsTaxIncluded: 0, TaxTypeId: null },
    ]);
    expect(grouped.get('a').isTaxIncluded).toBe(true);
    expect(grouped.get('b').isTaxIncluded).toBe(false);
  });
});

describe('getChainForCostInfos', () => {
  it('issues exactly one query for many ids', async () => {
    mockConn.execute.mockResolvedValue([[]]);
    await repository.getChainForCostInfos(['a', 'b', 'c'], TENANT);
    expect(mockConn.execute).toHaveBeenCalledTimes(1);
  });

  it('binds tenant first, then every id', async () => {
    mockConn.execute.mockResolvedValue([[]]);
    await repository.getChainForCostInfos(['a', 'b'], TENANT);
    const [, params] = mockConn.execute.mock.calls[0];
    expect(params).toEqual([TENANT, 'a', 'b']);
  });

  it('de-duplicates repeated ids', async () => {
    mockConn.execute.mockResolvedValue([[]]);
    await repository.getChainForCostInfos(['a', 'a', 'b'], TENANT);
    const [, params] = mockConn.execute.mock.calls[0];
    expect(params).toEqual([TENANT, 'a', 'b']);
  });

  it('drops null/undefined ids', async () => {
    mockConn.execute.mockResolvedValue([[]]);
    await repository.getChainForCostInfos(['a', null, undefined], TENANT);
    const [, params] = mockConn.execute.mock.calls[0];
    expect(params).toEqual([TENANT, 'a']);
  });

  it('short-circuits without querying when there are no ids', async () => {
    const result = await repository.getChainForCostInfos([], TENANT);
    expect(result.size).toBe(0);
    expect(mockConn.execute).not.toHaveBeenCalled();
  });

  it('filters the chain by tenant and Active in SQL', async () => {
    mockConn.execute.mockResolvedValue([[]]);
    await repository.getChainForCostInfos(['a'], TENANT);
    const [sql] = mockConn.execute.mock.calls[0];
    expect(sql).toContain('tg.Active = 1');
    expect(sql).toContain('tgm.Active = 1');
    expect(sql).toContain('tt.Active = 1');
    expect(sql).toContain('ci.TenantId = ?');
  });
});

describe('getTaxGroupComponents', () => {
  it('returns the group with its active components', async () => {
    mockConn.execute.mockResolvedValue([[
      { TaxGroupId: 'tg1', TaxGroupName: 'GST18', TaxTypeId: 'c1', TaxTypeName: 'CGST', TaxTypeValue: '9' },
      { TaxGroupId: 'tg1', TaxGroupName: 'GST18', TaxTypeId: 's1', TaxTypeName: 'SGST', TaxTypeValue: '9' },
    ]]);
    const group = await repository.getTaxGroupComponents('tg1', TENANT);
    expect(group.taxGroupName).toBe('GST18');
    expect(group.components).toHaveLength(2);
  });

  it('returns an empty component list for an exempt group', async () => {
    mockConn.execute.mockResolvedValue([[
      { TaxGroupId: 'tg2', TaxGroupName: 'Exempt', TaxTypeId: null },
    ]]);
    expect((await repository.getTaxGroupComponents('tg2', TENANT)).components).toEqual([]);
  });

  it('returns null when the group does not exist', async () => {
    mockConn.execute.mockResolvedValue([[]]);
    expect(await repository.getTaxGroupComponents('nope', TENANT)).toBeNull();
  });
});
