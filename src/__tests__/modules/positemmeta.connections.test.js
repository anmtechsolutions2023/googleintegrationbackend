// One request, ONE connection — for a service whose getById ENRICHES.
//
// BaseCRUDService.update and delete were careful: they opened a connection and
// handed it down, `this.getById(id, tenantId, false, connection)`. But five
// subclasses override getById to enrich the row — nutrition, a tax breakdown,
// trading hours — and those overrides predate the 4th parameter. Their
// signature is `getById(id, tenantId, expand)`, so the connection was silently
// DROPPED and each enrichment took one of its own.
//
// A delete therefore cost four connections at once and hung: at a pool of one
// on the very first call, at four once a few overlapped. mysql2 has no acquire
// timeout, so it never came back — the log stopped after "Fetching POS Item
// Meta by ID" with no success and no error.
//
// The call-site scanner in common/oneConnectionPerRequest cannot see this: the
// call site is correct, and the arity mismatch is in the override. This counts
// instead.

jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  captureAudit: jest.fn(),
}));
jest.mock('uuid', () => ({ v4: jest.fn(() => 'mock-uuid') }));

const ROW = {
  Id: 'm1', TenantId: 'tn', ItemDetailId: 'i1', FoodTypeId: 'f1',
  BranchDetailId: 'b1', CostInfoId: null, Active: 1,
};

const stats = { acquired: 0, held: 0, peak: 0 };

jest.mock('../../config/db', () => ({
  getConnection: jest.fn(async () => {
    stats.acquired += 1;
    stats.held += 1;
    stats.peak = Math.max(stats.peak, stats.held);
    return {
      execute: jest.fn(async (sql) => (/^\s*SELECT/i.test(sql)
        ? [[ROW]]
        : [{ affectedRows: 1 }])),
      query: jest.fn(async () => [[ROW]]),
      beginTransaction: jest.fn(),
      commit: jest.fn(),
      rollback: jest.fn(),
      release: jest.fn(() => { stats.held -= 1; }),
    };
  }),
}));

// The enrichers reach the database themselves; this suite is about how many
// connections the WRITE path holds, not about what they return.
jest.mock('../../modules/pricing/pricing.enrich', () => ({
  attachBreakdown: jest.fn(async (rows) => rows),
  attachBreakdownToOne: jest.fn(async (row) => row),
  taxBreakdownEcho: () => require('joi').any().optional().strip(),
}));
jest.mock('../../modules/poscategoryschedule/poscategoryschedule.service', () => ({
  getAllForTenant: jest.fn(async () => []),
  getTimeZone: jest.fn(async () => 'Asia/Kolkata'),
  indexByCategory: jest.fn(() => new Map()),
  availabilityOf: jest.fn(() => ({ available: true, opensAt: null })),
}));

const service = require('../../modules/positemmeta/positemmeta.service');

beforeEach(() => {
  stats.acquired = 0; stats.held = 0; stats.peak = 0;
  jest.clearAllMocks();
});

describe('deleting a menu item', () => {
  it('never holds two connections at once', async () => {
    await service.remove('m1', 'tn');
    expect(stats.peak).toBe(1);
  });

  it('gives the connection back', async () => {
    await service.remove('m1', 'tn');
    expect(stats.held).toBe(0);
  });

  // The one that actually hung: the existence check must not run the enriching
  // override while the delete is holding its connection.
  it('checks existence on the connection it already holds', async () => {
    await service.remove('m1', 'tn');
    expect(stats.acquired).toBe(1);
  });
});

describe('updating a menu item', () => {
  it('never holds two connections at once', async () => {
    await service.update('m1', { ServesCount: 2 }, 'tn', '+919999999999');
    expect(stats.peak).toBe(1);
  });

  it('gives every connection back', async () => {
    await service.update('m1', { ServesCount: 2 }, 'tn', '+919999999999');
    expect(stats.held).toBe(0);
  });
});

describe('reading one menu item', () => {
  it('never holds two at once, however much it enriches', async () => {
    await service.getById('m1', 'tn');
    expect(stats.peak).toBe(1);
    expect(stats.held).toBe(0);
  });
});
