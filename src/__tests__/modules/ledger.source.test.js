// How a ledger document is identified to a human: by token, by table, or by
// neither. One rule, applied by the list read and the detail read alike — the
// document used to stand alone with no way back to the floor it came from.

jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  captureAudit: jest.fn(),
}));

let state;
const executed = [];
const mockConn = {
  execute: jest.fn(async (sql, params) => {
    executed.push({ sql: String(sql), params });
    const q = String(sql);
    // Routed on markers unique to each query — the list and the full read both
    // select FROM transactiondetaillog, so a looser pattern matches both.
    if (/COUNT\(\*\) AS total/.test(q)) return [[{ total: state.list.length }]];
    if (/TokenLabels/.test(q)) return [state.list];
    if (/AS OrderId/.test(q)) return [state.orders];
    if (/FROM transactiondetaillog/.test(q)) return [state.log ? [state.log] : []];
    return [[]];
  }),
};
jest.mock('../../utils/dbHelper', () => ({ withConnection: async (cb) => cb(mockConn) }));

const read = require('../../modules/ledger/ledger.read.service');

const TENANT = 'tn';

beforeEach(() => {
  executed.length = 0;
  mockConn.execute.mockClear();
  state = {
    list: [],
    orders: [],
    log: { Id: 'l1', TransactionNo: 'INV-0006', StatusName: 'SETTLED', TaxByComponent: '[]' },
  };
});

describe('ledger list — token or table, per row', () => {
  it('labels a counter sale by its token', async () => {
    state.list = [{ Id: 'l1', TransactionNo: 'INV-0006', TokenLabels: '7', TableNames: null, OrderNos: 'ORD-0007' }];
    const { data } = await read.listDocuments({}, 1, 10, TENANT);
    expect(data[0].Source).toEqual({ kind: 'token', label: '7', orderNos: ['ORD-0007'] });
  });

  it('labels a dine-in sale by its table', async () => {
    state.list = [{ Id: 'l2', TokenLabels: null, TableNames: 'G02', OrderNos: 'ORD-0002, ORD-0003' }];
    const { data } = await read.listDocuments({}, 1, 10, TENANT);
    expect(data[0].Source).toEqual({
      kind: 'table', label: 'G02', orderNos: ['ORD-0002', 'ORD-0003'],
    });
  });

  // An expense document covers no rounds. Absent is a fact, not an error.
  it('labels a document with neither as neither', async () => {
    state.list = [{ Id: 'l3', TokenLabels: null, TableNames: null, OrderNos: null }];
    const { data } = await read.listDocuments({}, 1, 10, TENANT);
    expect(data[0].Source).toEqual({ kind: 'none', label: null, orderNos: [] });
  });

  // A bill covering three rounds must not fan its row out and triple every
  // total in the list — which is why these are correlated subqueries.
  it('reads the identifiers as subqueries, never as joins that multiply rows', async () => {
    state.list = [{ Id: 'l1', TokenLabels: '7', TableNames: null, OrderNos: 'ORD-0007' }];
    await read.listDocuments({}, 1, 10, TENANT);
    const listSql = executed.find((e) => /TokenLabels/.test(e.sql)).sql;
    expect(listSql).toMatch(/\(SELECT GROUP_CONCAT\(DISTINCT tk\.TokenLabel/);
    expect(listSql).not.toMatch(/FROM transactiondetaillog l\s+JOIN pos_bill/);
  });
});

describe('ledger detail — the rounds behind the invoice', () => {
  it('returns each round with its token and venue', async () => {
    state.orders = [
      { OrderId: 'o1', OrderNo: 'ORD-0007', TokenLabel: '7', TableName: null, OrderTotal: '270.00' },
    ];
    const doc = await read.getDocument('l1', TENANT);
    expect(doc.Orders).toHaveLength(1);
    expect(doc.Orders[0].OrderNo).toBe('ORD-0007');
  });

  // The same rule as the list. If they differed, a document would be labelled
  // one way in the table and another way when opened.
  it('identifies the document the same way the list does', async () => {
    state.orders = [{ OrderId: 'o1', OrderNo: 'ORD-0007', TokenLabel: '7', TableName: null }];
    const doc = await read.getDocument('l1', TENANT);
    expect(doc.Source).toEqual({ kind: 'token', label: '7', orderNos: ['ORD-0007'] });
  });

  it('prefers the token when a round has both — that is what was handed over', async () => {
    state.orders = [{ OrderId: 'o1', OrderNo: 'ORD-1', TokenLabel: '9', TableName: 'G02' }];
    const doc = await read.getDocument('l1', TENANT);
    expect(doc.Source.kind).toBe('token');
  });

  it('joins several rounds into one label', async () => {
    state.orders = [
      { OrderId: 'o1', OrderNo: 'ORD-0002', TokenLabel: null, TableName: 'G02' },
      { OrderId: 'o2', OrderNo: 'ORD-0003', TokenLabel: null, TableName: 'G02' },
    ];
    const doc = await read.getDocument('l1', TENANT);
    // Deduplicated: two rounds on one table is one table.
    expect(doc.Source.label).toBe('G02');
    expect(doc.Source.orderNos).toEqual(['ORD-0002', 'ORD-0003']);
  });

  it('leaves an expense document with no orders rather than failing', async () => {
    state.orders = [];
    const doc = await read.getDocument('l1', TENANT);
    expect(doc.Orders).toEqual([]);
    expect(doc.Source.kind).toBe('none');
  });
});
