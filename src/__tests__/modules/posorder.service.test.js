// Service-level tests for the two order-lifecycle guards: fire-KOT-once and
// delete-round-with-cascade. A single mock connection stands in for both the
// per-call connection (getById) and the transaction.

let state;
const executed = [];
const mockConn = {
  execute: jest.fn(async (sql, params) => {
    executed.push({ sql, params });
    if (sql.includes('SELECT * FROM pos_order')) return [state.order ? [state.order] : []];
    if (sql.startsWith('SELECT Status FROM pos_kot')) return [state.kots || []];
    if (sql.includes('SELECT * FROM pos_table')) {
      return [[{ Id: 't1', Name: 'T1', FloorId: 'g', Capacity: 4, BranchDetailId: 'br', Status: 'Occupied', Active: 1 }]];
    }
    if (sql.startsWith('SELECT Id FROM pos_order')) return [state.openAfterDelete || []];
    return [{ affectedRows: 1 }];
  }),
};

jest.mock('../../utils/dbHelper', () => ({
  withTransaction: (fn) => fn(mockConn),
  withConnection: (fn) => fn(mockConn),
}));

const service = require('../../modules/posorder/posorder.service');
const { HttpError } = require('../../middleware/errorHandler');

beforeEach(() => { executed.length = 0; state = {}; mockConn.execute.mockClear(); });

const sqlsMatching = (re) => executed.filter((e) => re.test(e.sql));

describe('fireKot — fire once per round', () => {
  it('rejects a second fire on an already-fired round', async () => {
    state.order = { Id: 'o1', TableId: 't1', Status: 'fired', Items: [] };
    await expect(service.fireKot('o1', {}, 'tn', 'u@x'))
      .rejects.toMatchObject({ statusCode: 409 });
    // No KOT was inserted the second time.
    expect(sqlsMatching(/INSERT INTO pos_kot/)).toHaveLength(0);
  });

  it('fires and marks the round fired when it is still open', async () => {
    state.order = { Id: 'o1', TableId: 't1', Status: 'Active', Items: [{ name: 'A' }], BranchDetailId: 'br' };
    const res = await service.fireKot('o1', { KotNo: 'KOT-1' }, 'tn', 'u@x');
    expect(res).toMatchObject({ OrderId: 'o1', Status: 'pending' });
    expect(sqlsMatching(/INSERT INTO pos_kot/)).toHaveLength(1);
    // Status flipped to 'fired' via SET_STATUS.
    const setStatus = sqlsMatching(/SET Status = \?, UpdatedOn/).at(-1);
    expect(setStatus.params[0]).toBe('fired');
  });
});

describe('deleteRound — remove a round even after KOT fired', () => {
  it('cascades: pulls the KOT, deletes the order, refreshes the table', async () => {
    state.order = { Id: 'o1', TableId: 't1', Status: 'fired', Items: [] };
    state.kots = [{ Status: 'pending' }]; // fired but not yet started → deletable
    state.openAfterDelete = []; // table has no rounds left afterwards
    const res = await service.remove('o1', 'tn', 'u@x');

    expect(res).toEqual({ deletedOrderId: 'o1' });
    expect(sqlsMatching(/DELETE FROM pos_kot WHERE OrderId/)).toHaveLength(1);
    expect(sqlsMatching(/DELETE FROM pos_order/)).toHaveLength(1);
    // Table refreshed to Available (no open orders remain).
    const tableUpdate = sqlsMatching(/UPDATE pos_table SET Name/).at(-1);
    expect(tableUpdate.params[3]).toBe('Available');
    expect(tableUpdate.params[4]).toBeNull(); // CurrentOrderId cleared
  });

  it('keeps the table occupied when other rounds remain', async () => {
    state.order = { Id: 'o1', TableId: 't1', Status: 'Active', Items: [] };
    state.openAfterDelete = [{ Id: 'o2' }];
    await service.remove('o1', 'tn', 'u@x');
    const tableUpdate = sqlsMatching(/UPDATE pos_table SET Name/).at(-1);
    expect(tableUpdate.params[3]).toBe('Occupied');
    expect(tableUpdate.params[4]).toBe('o2');
  });

  it('refuses once the kitchen has started the round (KOT past pending)', async () => {
    state.order = { Id: 'o1', TableId: 't1', Status: 'fired', Items: [] };
    state.kots = [{ Status: 'ready' }];
    await expect(service.remove('o1', 'tn', 'u@x'))
      .rejects.toMatchObject({ statusCode: 409 });
    // Nothing was deleted.
    expect(sqlsMatching(/DELETE FROM pos_order/)).toHaveLength(0);
  });

  it('404s when the order does not exist', async () => {
    state.order = null;
    await expect(service.remove('missing', 'tn', 'u@x'))
      .rejects.toBeInstanceOf(HttpError);
  });
});
