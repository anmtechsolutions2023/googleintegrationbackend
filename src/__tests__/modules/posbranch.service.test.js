// The POS branch picker.
//
// Exists because /api/branchdetails is governed by ORGANIZATION_READ, and every
// POS screen scoped to one outlet — the token queue, the customer display, the
// per-branch settings — still has to NAME the branch it is showing. A cashier
// carrying an Organization scope just to render a dropdown is the wrong trade.

jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  captureAudit: jest.fn(),
}));

const executed = [];
const mockConn = {
  execute: jest.fn(async (sql, params) => {
    executed.push({ sql, params });
    return [[
      { Id: 'b1', BranchName: 'Airport' },
      { Id: 'b2', BranchName: 'Central' },
    ]];
  }),
};
jest.mock('../../utils/dbHelper', () => ({
  withConnection: (fn) => fn(mockConn),
}));

const service = require('../../modules/posbranch/posbranch.service');
const routes = require('../../modules/posbranch/posbranch.routes');

beforeEach(() => { executed.length = 0; mockConn.execute.mockClear(); });

describe('posbranch', () => {
  it('lists the tenant\'s branches', async () => {
    const rows = await service.list('tn');
    expect(rows).toHaveLength(2);
    expect(executed[0].params).toEqual(['tn']);
  });

  it('is scoped to the tenant', async () => {
    await service.list('tn');
    expect(executed[0].sql).toMatch(/WHERE TenantId = \?/);
  });

  // Least privilege applies to columns too: a picker needs a name and an id,
  // not addresses, GSTIN or contact ids.
  it('selects only what a picker needs', async () => {
    await service.list('tn');
    expect(executed[0].sql).toMatch(/SELECT Id, BranchName FROM branchdetail/);
    expect(executed[0].sql).not.toMatch(/GSTIN|AddressDetailId|ContactDetailId|\*/);
  });

  it('orders by name, so the dropdown is not in insertion order', async () => {
    await service.list('tn');
    expect(executed[0].sql).toMatch(/ORDER BY BranchName/);
  });

  // The whole point of the module. A write route here would recreate the
  // organization module under a POS scope.
  it('exposes no write routes', () => {
    const methods = routes.stack
      .filter((l) => l.route)
      .flatMap((l) => Object.keys(l.route.methods));
    expect(methods).toEqual(['get']);
  });
});
