// src/__tests__/modules/asset.service.test.js
// The asset register answers "what equipment does this outlet have, and what is
// it worth". Everything here follows from that: an asset must have a branch.

jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  captureAudit: jest.fn(),
}));

let mockUuidCounter = 0;
jest.mock('uuid', () => ({ v4: jest.fn(() => `uuid-${++mockUuidCounter}`) }));

const mockConn = { execute: jest.fn() };
jest.mock('../../utils/dbHelper', () => ({
  withConnection: jest.fn(async (cb) => cb(mockConn)),
  withTransaction: jest.fn(async (cb) => cb(mockConn)),
}));

const service = require('../../modules/asset/asset.service');
const { createSchema, updateSchema } = require('../../modules/asset/asset.schemas');

const TENANT = 'tenant-1';
const USER = 'admin@test.com';
const UUID = '11111111-1111-1111-1111-111111111111';

const VALID = {
  Name: 'Deep Fryer',
  AssetCategoryId: UUID,
  BranchDetailId: UUID,
  PurchaseCost: 45000,
};

const callsTo = (re) => mockConn.execute.mock.calls.filter(([s]) => re.test(String(s)));

beforeEach(() => {
  jest.clearAllMocks();
  mockUuidCounter = 0;
  mockConn.execute.mockImplementation((sql) => {
    const q = String(sql);
    if (/SUM\(a\.PurchaseCost\)/i.test(q)) {
      return Promise.resolve([[
        { BranchDetailId: 'b1', BranchName: 'Koramangala', CategoryName: 'Kitchen Equipment', Assets: '3', PurchaseCost: '135000.00' },
        { BranchDetailId: 'b1', BranchName: 'Koramangala', CategoryName: 'Furniture', Assets: '10', PurchaseCost: '50000.00' },
        { BranchDetailId: 'b2', BranchName: 'Indiranagar', CategoryName: 'IT Equipment', Assets: '2', PurchaseCost: '80000.00' },
      ]]);
    }
    if (/^\s*SELECT/i.test(q)) return Promise.resolve([[{ Id: 'asset-1', Name: 'Deep Fryer', BranchDetailId: 'b1' }]]);
    return Promise.resolve([{ affectedRows: 1 }]);
  });
});

describe('an asset belongs to a branch', () => {
  it('requires a branch — a tenant-level asset answers nothing', () => {
    const { BranchDetailId, ...noBranch } = VALID;
    expect(createSchema.validate(noBranch).error).toBeDefined();
  });

  it('requires a category so the register can be analysed', () => {
    const { AssetCategoryId, ...noCategory } = VALID;
    expect(createSchema.validate(noCategory).error).toBeDefined();
  });

  it('accepts a complete registration', () => {
    expect(createSchema.validate(VALID).error).toBeUndefined();
  });

  it('defaults a new asset to in_use', () => {
    expect(createSchema.validate(VALID).value.Status).toBe('in_use');
  });

  it('restricts status to the known lifecycle', () => {
    expect(updateSchema.validate({ Status: 'retired' }).error).toBeUndefined();
    expect(updateSchema.validate({ Status: 'on_fire' }).error).toBeDefined();
  });

  it('rejects a negative purchase cost', () => {
    expect(createSchema.validate({ ...VALID, PurchaseCost: -1 }).error).toBeDefined();
  });
});

describe('serial numbers', () => {
  it('stores a blank serial as NULL, not empty string', async () => {
    // UNIQUE(SerialNo, TenantId) would collide for every serial-less asset if
    // blanks were stored as ''.
    await service.create({ ...VALID, SerialNo: '' }, TENANT, USER);
    const params = callsTo(/INSERT INTO asset\b/i)[0][1];
    expect(params[5]).toBeNull();
  });

  it('keeps a real serial', async () => {
    await service.create({ ...VALID, SerialNo: 'SN-42' }, TENANT, USER);
    expect(callsTo(/INSERT INTO asset\b/i)[0][1][5]).toBe('SN-42');
  });
});

describe('register summary', () => {
  it('groups value by branch and category', async () => {
    const r = await service.summary(TENANT);
    expect(r.groups).toHaveLength(3);
    expect(r.groups[0]).toMatchObject({ BranchName: 'Koramangala', Assets: 3, PurchaseCost: 135000 });
  });

  it('totals the register across branches', async () => {
    const r = await service.summary(TENANT);
    expect(r.totalAssets).toBe(15);
    expect(r.totalValue).toBe(265000);
  });

  it('counts only active assets', async () => {
    await service.summary(TENANT);
    expect(callsTo(/SUM\(a\.PurchaseCost\)/i)[0][0]).toMatch(/a\.Active = 1/);
  });
});
