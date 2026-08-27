// src/__tests__/modules/ledger.read.service.test.js
//
// The two lists a business tracks returns from: the ledger (which documents
// exist) and the register (which credit notes exist).
//
// What is asserted is the FILTER CONTRACT — that every axis somebody needs to
// search on reaches SQL as a bound parameter, in the right order, and that the
// three predicates which cannot be a simple column comparison (refund state,
// which dish, whether it was our fault) are expressed in a way that does not
// quietly change the totals on the page.

jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  captureAudit: jest.fn(),
}));

const mockConn = { execute: jest.fn() };
jest.mock('../../utils/dbHelper', () => ({
  withConnection: jest.fn(async (cb) => cb(mockConn)),
  withTransaction: jest.fn(async (cb) => cb(mockConn)),
  findOneOrFail: jest.fn(), findAll: jest.fn(), executeQuery: jest.fn(),
}));

const read = require('../../modules/ledger/ledger.read.service');

const TENANT = 'tenant-1';

// Every SELECT the list paths make, in order: count, (totals), rows, and for the
// ledger the bulk returned-totals read.
const routeList = (rows = []) => {
  mockConn.execute.mockImplementation((sql) => {
    const q = String(sql);
    if (/COUNT\(\*\) AS total/i.test(q)) return Promise.resolve([[{ total: rows.length }]]);
    if (/SUM\(l\.GrossAmount\)/i.test(q) && /AS ReturnedAmount/i.test(q)) {
      return Promise.resolve([[{
        ReturnedAmount: 6240, ReturnedNet: 5288, ReturnedTax: 952,
        ReturnCount: 37, FaultAmount: 4100,
      }]]);
    }
    return Promise.resolve([rows]);
  });
};

const call = (re) => mockConn.execute.mock.calls.find(([sql]) => re.test(String(sql)));
const rowsQuery = () => call(/LIMIT \d+ OFFSET \d+/);

beforeEach(() => jest.clearAllMocks());

describe('the credit-note register', () => {
  const list = (filters) => read.listReturns(filters, 1, 25, TENANT);

  it('binds every filter as a parameter, never as text in the SQL', async () => {
    routeList([]);
    await list({
      fromDate: '2026-08-01', toDate: '2026-08-27', branchId: 'b-1',
      reasonId: 'r-1', settlementStatus: 'PENDING', contactDetailId: 'c-1',
      createdBy: 'priya@test.com', minAmount: 100, maxAmount: 5000,
    });

    const [sql, params] = rowsQuery();
    expect(String(sql)).not.toMatch(/priya@test\.com/);
    expect(params).toEqual([
      TENANT, 'POS Return',
      '2026-08-01', '2026-08-27', 'b-1', 'r-1', 'PENDING', 'c-1',
      'priya@test.com', 100, 5000,
    ]);
  });

  // The count, the totals and the rows must all carry the SAME predicate, or
  // "37 credit notes, ₹6,240" would describe a different set from the rows
  // underneath it.
  it('applies one filter set to the rows, the count and the totals alike', async () => {
    routeList([]);
    await list({ reasonId: 'r-1' });

    const [, countParams] = call(/COUNT\(\*\) AS total/);
    const [, totalParams] = call(/AS ReturnedAmount/);
    const [, rowParams] = rowsQuery();
    expect(countParams).toEqual(rowParams);
    expect(totalParams).toEqual(rowParams);
  });

  // Joining the lines to filter on an item would fan a two-line note into two
  // rows and double every figure on the page.
  it('matches an item with EXISTS so a multi-line note stays one row', async () => {
    routeList([]);
    await list({ itemId: 'i-1' });
    const [sql, params] = rowsQuery();
    expect(String(sql)).toMatch(/EXISTS \(SELECT 1 FROM transactionitemdetail/i);
    expect(String(sql)).not.toMatch(/JOIN transactionitemdetail ti\b/i);
    expect(params).toContain('i-1');
  });

  // A note written before the settlement column existed must read as PENDING
  // rather than dropping out of the worklist entirely.
  it('treats a missing settlement status as PENDING', async () => {
    routeList([]);
    await list({ settlementStatus: 'PENDING' });
    expect(String(rowsQuery()[0])).toMatch(/COALESCE\(l\.SettlementStatus, 'PENDING'\) = \?/);
  });

  it('takes the fault split as a boolean, in both directions', async () => {
    routeList([]);
    await list({ isFault: false });
    expect(rowsQuery()[1]).toContain(0);

    jest.clearAllMocks();
    routeList([]);
    await list({ isFault: true });
    expect(rowsQuery()[1]).toContain(1);
  });

  it('searches the note number, the invoice it came off, and the customer', async () => {
    routeList([]);
    await list({ search: '0418' });
    const [sql, params] = rowsQuery();
    expect(String(sql)).toMatch(/orig\.TransactionNo LIKE \?/);
    expect(params.filter((p) => p === '%0418%')).toHaveLength(4);
  });

  // What separates "a whole meal came back" from "one side dish".
  it('reports each note as a share of the sale it came off', async () => {
    routeList([{ Id: 'cn1', GrossAmount: 472, SaleGross: 1180, IsFault: 1 }]);
    const result = await list({});
    expect(result.data[0].ShareOfSale).toBe(40);
    expect(result.data[0].IsFault).toBe(true);
  });

  it('does not divide by a sale it cannot see', async () => {
    routeList([{ Id: 'cn1', GrossAmount: 472, SaleGross: null }]);
    const result = await list({});
    expect(result.data[0].ShareOfSale).toBeNull();
  });

  // "₹6,240 returned this month" must not change when somebody turns the page.
  it('returns totals for the whole filtered set, not the page', async () => {
    routeList([{ Id: 'cn1', GrossAmount: 472, SaleGross: 1180 }]);
    const result = await list({});
    expect(result.totals).toEqual({
      ReturnedAmount: 6240, ReturnedNet: 5288, ReturnedTax: 952,
      ReturnCount: 37, FaultAmount: 4100,
    });
  });
});

describe('the ledger list', () => {
  const list = (filters) => read.listDocuments(filters, 1, 25, TENANT);

  // The ledger holds sales, expenses AND credit notes. Without this a CN-0007
  // sat in the list looking exactly like a sale of the same value.
  it('filters by document type', async () => {
    routeList([]);
    await list({ docType: 'POS Return' });
    const [sql, params] = rowsQuery();
    expect(String(sql)).toMatch(/t\.Name = \?/);
    expect(params).toContain('POS Return');
  });

  // Refund state is DERIVED from the credit notes, not stored — so it is a
  // predicate over them, and it never touches `status`. A partly-refunded sale
  // is still SETTLED, which is exactly what lets a second return happen.
  it.each([
    ['NONE', /NOT EXISTS/i],
    ['PARTIALLY_REFUNDED', /BETWEEN 0\.01 AND l\.GrossAmount - 0\.01/i],
    ['REFUNDED', />= l\.GrossAmount - 0\.01/i],
  ])('expresses refundState %s over the credit notes', async (state, pattern) => {
    routeList([]);
    await list({ refundState: state });
    const [sql, params] = rowsQuery();
    expect(String(sql)).toMatch(pattern);
    // Derived, so it binds nothing — the only parameter is the tenant.
    expect(params).toEqual([TENANT]);
  });

  it('combines refund state with status rather than replacing it', async () => {
    routeList([]);
    await list({ status: 'SETTLED', refundState: 'PARTIALLY_REFUNDED' });
    const [sql, params] = rowsQuery();
    expect(String(sql)).toMatch(/s\.Name = \?/);
    expect(String(sql)).toMatch(/BETWEEN 0\.01 AND/i);
    expect(params).toEqual([TENANT, 'SETTLED']);
  });

  it('decorates each sale with what has come back against it', async () => {
    mockConn.execute.mockImplementation((sql) => {
      const q = String(sql);
      if (/COUNT\(\*\) AS total/i.test(q)) return Promise.resolve([[{ total: 1 }]]);
      if (/LIMIT \d+ OFFSET \d+/.test(q)) {
        return Promise.resolve([[{ Id: 'l1', TransactionNo: 'INV-0418', GrossAmount: 1180 }]]);
      }
      return Promise.resolve([[{ saleId: 'l1', returned: 708, noteCount: 2 }]]);
    });

    const result = await list({});
    const doc = result.data[0];
    // The original total is NEVER reduced — it is what the customer's printed
    // bill says, and a list that overwrote it would stop matching the paper.
    expect(doc.GrossAmount).toBe(1180);
    expect(doc.ReturnedAmount).toBe(708);
    expect(doc.NetOfReturns).toBe(472);
    expect(doc.RefundState).toBe('PARTIALLY_REFUNDED');
    expect(doc.ReturnCount).toBe(2);
  });
});
