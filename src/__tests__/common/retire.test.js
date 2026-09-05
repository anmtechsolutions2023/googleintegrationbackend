// Deleting a floor-plan row must not destroy the trading history the venue
// reports are built on — nor fail with an opaque foreign-key error for what is a
// perfectly reasonable request ("we removed that table").

jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  captureAudit: jest.fn(),
}));

const mockConn = { execute: jest.fn() };
jest.mock('../../utils/dbHelper', () => ({
  withConnection: jest.fn(async (cb) => cb(mockConn)),
  withTransaction: jest.fn(async (cb) => cb(mockConn)),
}));

const { deleteOrRetire } = require('../../common/retire');

const ARGS = {
  table: 'pos_table',
  entityName: 'POS Table',
  references: [{ table: 'pos_order', column: 'TableId' }],
  deleteQuery: 'DELETE FROM pos_table WHERE Id = ? AND TenantId = ?',
  id: 't1',
  tenantId: 'tn',
  userPhone: 'u@x',
};

// exists: is there such a row? used: does anything reference it?
const route = ({ exists = true, used = false } = {}) => {
  mockConn.execute.mockImplementation((sql) => {
    const q = String(sql);
    if (/SELECT Id FROM pos_table/.test(q)) return Promise.resolve([exists ? [{ Id: 't1' }] : []]);
    if (/SELECT 1 FROM pos_order/.test(q)) return Promise.resolve([used ? [{ 1: 1 }] : []]);
    return Promise.resolve([{ affectedRows: 1 }]);
  });
};

const sqlsMatching = (re) =>
  mockConn.execute.mock.calls.map(([s]) => String(s)).filter((s) => re.test(s));

beforeEach(() => { jest.clearAllMocks(); route(); });

describe('deleteOrRetire', () => {
  it('deletes a row nothing depends on', async () => {
    route({ used: false });
    await expect(deleteOrRetire(ARGS)).resolves.toEqual({ id: 't1', retired: false });
    expect(sqlsMatching(/^DELETE FROM pos_table/)).toHaveLength(1);
  });

  it('retires a row that has history instead of deleting it', async () => {
    route({ used: true });
    await expect(deleteOrRetire(ARGS)).resolves.toEqual({ id: 't1', retired: true });

    expect(sqlsMatching(/^DELETE FROM pos_table/)).toHaveLength(0);
    const [update] = sqlsMatching(/UPDATE pos_table SET Active = 0/);
    expect(update).toBeDefined();
  });

  it('leaves the referencing rows completely alone', async () => {
    // Cascading would be worse than failing: it would erase the orders that
    // table served, which is exactly the data the reports need.
    route({ used: true });
    await deleteOrRetire(ARGS);
    expect(sqlsMatching(/DELETE FROM pos_order|UPDATE pos_order/)).toHaveLength(0);
  });

  it('404s for a row that is not there', async () => {
    route({ exists: false });
    await expect(deleteOrRetire(ARGS)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('scopes every statement to the tenant', async () => {
    route({ used: true });
    await deleteOrRetire(ARGS);
    mockConn.execute.mock.calls.forEach(([sql, params]) => {
      expect(String(sql)).toMatch(/TenantId = \?/);
      expect(params).toContain('tn');
    });
  });

  it('retires on the FIRST reference found, without asking the rest', async () => {
    route({ used: true });
    await deleteOrRetire({
      ...ARGS,
      references: [
        { table: 'pos_order', column: 'TableId' },
        { table: 'pos_kot', column: 'TableId' },
      ],
    });
    expect(sqlsMatching(/FROM pos_kot/)).toHaveLength(0);
  });
});
