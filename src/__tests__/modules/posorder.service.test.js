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
    // findLiveKotTx — the round's existing ticket, if any.
    if (sql.startsWith('SELECT Id, KotNo, Status FROM pos_kot')) {
      return [state.liveKot ? [state.liveKot] : []];
    }
    if (sql.includes('SELECT * FROM pos_table')) {
      return [[{ Id: 't1', Name: 'T1', FloorId: 'g', Capacity: 4, BranchDetailId: 'br', Status: 'occupied', Active: 1 }]];
    }
    if (sql.startsWith('SELECT Id FROM pos_order')) return [state.openAfterDelete || []];
    return [{ affectedRows: 1 }];
  }),
  // BaseCRUDService.getAll uses query(), not execute(), because MySQL cannot
  // parameterise LIMIT/OFFSET. The unfiltered list path goes through it.
  query: jest.fn(async () => [[]]),
};

jest.mock('../../utils/dbHelper', () => ({
  withTransaction: (fn) => fn(mockConn),
  withConnection: (fn) => fn(mockConn),
}));

const service = require('../../modules/posorder/posorder.service');
const { HttpError } = require('../../middleware/errorHandler');

beforeEach(() => { executed.length = 0; state = {}; mockConn.execute.mockClear(); });

const sqlsMatching = (re) => executed.filter((e) => re.test(e.sql));

// Sending a round to the kitchen is a deliberate act, and it happens ONCE.
// Pressing the button twice used to put a second copy of the same food on the
// pass, and the kitchen cooked it twice.
describe('fireKot — send once', () => {
  it('sends a round that has no ticket yet', async () => {
    state.order = { Id: 'o1', TableId: 't1', Status: 'open', Items: [{ name: 'A' }], BranchDetailId: 'br' };
    const res = await service.fireKot('o1', { KotNo: 'KOT-1' }, 'tn', 'u@x');
    expect(res).toMatchObject({ OrderId: 'o1', Status: 'pending', AlreadySent: false });
    expect(sqlsMatching(/INSERT INTO pos_kot/)).toHaveLength(1);
    // Status flipped to 'fired' via SET_STATUS.
    const setStatus = sqlsMatching(/SET Status = \?, UpdatedOn/).at(-1);
    expect(setStatus.params[0]).toBe('fired');
  });

  it('writes nothing when the round is already on the pass', async () => {
    state.order = { Id: 'o1', TableId: 't1', Status: 'fired', Items: [] };
    state.liveKot = { Id: 'k1', KotNo: 'KOT-0001', Status: 'pending' };

    const res = await service.fireKot('o1', {}, 'tn', 'u@x');

    expect(res).toMatchObject({ KotId: 'k1', KotNo: 'KOT-0001', AlreadySent: true });
    expect(sqlsMatching(/INSERT INTO pos_kot/)).toHaveLength(0);
  });

  it('does not rewrite the existing ticket’s status', async () => {
    // It may already be 'ready'. Resetting it would erase the fact that the
    // kitchen finished the food.
    state.order = { Id: 'o1', TableId: 't1', Status: 'fired', Items: [] };
    state.liveKot = { Id: 'k1', KotNo: 'KOT-0001', Status: 'ready' };

    const res = await service.fireKot('o1', {}, 'tn', 'u@x');

    expect(res.Status).toBe('ready');
    expect(sqlsMatching(/UPDATE pos_kot SET Status/)).toHaveLength(0);
  });

  it('sends again once the previous ticket was cancelled', async () => {
    // A cancelled ticket was pulled from the pass, so this is not a duplicate.
    state.order = { Id: 'o1', TableId: 't1', Status: 'fired', Items: [] };
    state.liveKot = null; // the lookup excludes cancelled rows
    await service.fireKot('o1', {}, 'tn', 'u@x');
    expect(sqlsMatching(/INSERT INTO pos_kot/)).toHaveLength(1);
  });

  it('honours an explicit KotNo instead of issuing one', async () => {
    state.order = { Id: 'o1', TableId: 't1', Status: 'open', Items: [] };
    const res = await service.fireKot('o1', { KotNo: 'KOT-1' }, 'tn', 'u@x');
    expect(res.KotNo).toBe('KOT-1');
  });

  it('refuses a closed round — that food is history, not an order', async () => {
    state.order = { Id: 'o1', TableId: 't1', Status: 'closed', Items: [] };
    await expect(service.fireKot('o1', {}, 'tn', 'u@x'))
      .rejects.toMatchObject({ statusCode: 409 });
    expect(sqlsMatching(/INSERT INTO pos_kot/)).toHaveLength(0);
  });
});

// Billing needs one table's rounds to resume an occupied session. Pulling the
// whole order list and filtering in the browser silently lost rounds once an
// outlet traded past a page.
describe('getAll — narrowing to one table', () => {
  it('filters on the table when one is named', async () => {
    await service.getAll('tn', 1, 50, { tableId: 't1' });
    const selects = sqlsMatching(/SELECT \* FROM pos_order/);
    expect(selects.at(-1).sql).toMatch(/TableId = \?/);
    expect(selects.at(-1).params).toEqual(['tn', 't1']);
  });

  it('can exclude rounds that are no longer part of a live session', async () => {
    // A table that traded and settled this morning must not read as occupied.
    await service.getAll('tn', 1, 50, { tableId: 't1', openOnly: true });
    const sql = sqlsMatching(/SELECT \* FROM pos_order/).at(-1).sql;
    expect(sql).toMatch(/NOT IN \('closed', 'settled', 'cancelled'\)/);
  });

  it('returns rounds oldest-first, so Round 1 really is round 1', async () => {
    await service.getAll('tn', 1, 50, { tableId: 't1' });
    expect(sqlsMatching(/SELECT \* FROM pos_order/).at(-1).sql).toMatch(/ORDER BY CreatedOn ASC/);
  });

  it('scopes the count to the same table, so pagination is not a lie', async () => {
    await service.getAll('tn', 1, 50, { tableId: 't1' });
    const counts = sqlsMatching(/COUNT\(\*\)/);
    expect(counts.at(-1).sql).toMatch(/TableId = \?/);
  });

  it('behaves exactly as before when no filter is given', async () => {
    // Every existing caller passes no filters; this must not change for them.
    await service.getAll('tn', 1, 10);
    expect(sqlsMatching(/TableId = \?/)).toHaveLength(0);
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
    expect(tableUpdate.params[3]).toBe('free');
    expect(tableUpdate.params[4]).toBeNull(); // CurrentOrderId cleared
  });

  it('pulls the round\'s counter token before deleting the order', async () => {
    // pos_token.OrderId is a foreign key: leaving the token behind rejects the
    // delete outright with a raw SQL error the cashier cannot act on. And a
    // token still calling for food that no longer exists is worse than none.
    state.order = { Id: 'o1', TableId: null, Status: 'open', Items: [] };
    state.kots = [];
    await service.remove('o1', 'tn', 'u@x');

    const sqls = executed.map((e) => e.sql);
    const tokenDelete = sqls.findIndex((s) => /DELETE FROM pos_token WHERE OrderId/.test(s));
    const orderDelete = sqls.findIndex((s) => /DELETE FROM pos_order/.test(s));
    expect(tokenDelete).toBeGreaterThan(-1);
    expect(tokenDelete).toBeLessThan(orderDelete);
  });

  it('keeps the table occupied when other rounds remain', async () => {
    state.order = { Id: 'o1', TableId: 't1', Status: 'open', Items: [] };
    state.openAfterDelete = [{ Id: 'o2' }];
    await service.remove('o1', 'tn', 'u@x');
    const tableUpdate = sqlsMatching(/UPDATE pos_table SET Name/).at(-1);
    expect(tableUpdate.params[3]).toBe('occupied');
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
