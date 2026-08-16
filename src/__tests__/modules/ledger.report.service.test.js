// src/__tests__/modules/ledger.report.service.test.js
// The reporting engine. What matters here is not the arithmetic — MySQL does
// that — but that every report reads the LEDGER rather than pos_bill, bounds
// itself by date, and aggregates in SQL instead of in Node.

jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  captureAudit: jest.fn(),
}));

const mockConn = { execute: jest.fn() };
jest.mock('../../utils/dbHelper', () => ({
  withConnection: jest.fn(async (cb) => cb(mockConn)),
  withTransaction: jest.fn(async (cb) => cb(mockConn)),
}));

const reports = require('../../modules/ledger/ledger.report.service');
const { toISODate } = require('../../utils/dateRange');

const TENANT = 'tenant-1';

/** Answers each query shape with a plausible aggregate row. */
const route = (over = {}) => {
  mockConn.execute.mockImplementation((sql) => {
    const q = String(sql);
    if (/SUM\(l\.NetAmount\)/i.test(q)) {
      return Promise.resolve([[over.summary || {
        Documents: 3, NetAmount: '300.00', TaxAmount: '54.00', DiscountAmount: '20.00',
        RoundOff: '0.00', GrossAmount: '354.00', Collected: '300.00', Outstanding: '54.00',
      }]]);
    }
    if (/AS Bucket/i.test(q) && /pos_expense/i.test(q)) {
      return Promise.resolve([over.expenseTrend || [{ Bucket: '2026-08-01', Entries: 2, Amount: '150.00' }]]);
    }
    if (/AS Bucket/i.test(q)) {
      return Promise.resolve([over.trend || [{ Bucket: '2026-08-01', Documents: 3, GrossAmount: '354.00', DiscountAmount: '20.00', TaxAmount: '54.00' }]]);
    }
    // Venue and discount shapes are matched BEFORE the generic ones — they read
    // the same tables, and the broader patterns below would swallow them.
    if (/AS FloorName/i.test(q)) {
      return Promise.resolve([over.venue || [
        { FloorId: 'f1', FloorName: 'Ground', TableId: 't1', TableName: 'T1', Capacity: '4', Orders: '3', Bills: '2', NetAmount: '200.00', DiscountAmount: '0.00', TaxAmount: '36.00', GrossAmount: '236.00' },
        { FloorId: 'f1', FloorName: 'Ground', TableId: 't2', TableName: 'T2', Capacity: '2', Orders: '1', Bills: '1', NetAmount: '100.00', DiscountAmount: '0.00', TaxAmount: '18.00', GrossAmount: '118.00' },
        { FloorId: 'f2', FloorName: 'Rooftop', TableId: 't9', TableName: 'R1', Capacity: '6', Orders: '2', Bills: '1', NetAmount: '500.00', DiscountAmount: '50.00', TaxAmount: '90.00', GrossAmount: '590.00' },
      ]]);
    }
    if (/AS ItemDiscountAmount/i.test(q) && /COUNT\(DISTINCT l\.Id\)/i.test(q)) {
      return Promise.resolve([[over.discountSummary || {
        Documents: '4', DiscountAmount: '120.00', ItemDiscountAmount: '70.00',
        BillDiscountAmount: '50.00', GrossAmount: '2000.00',
      }]]);
    }
    if (/AS ItemDiscountAmount/i.test(q) && /ti\.ItemId/i.test(q)) {
      return Promise.resolve([over.discountProducts || [
        { ItemId: 'i1', ItemName: 'Dosa', QuantitySold: '5', DiscountAmount: '80.00', ItemDiscountAmount: '60.00', BillDiscountAmount: '20.00', GrossAmount: '900.00', Documents: '3' },
      ]]);
    }
    if (/AS ItemDiscountAmount/i.test(q)) {
      return Promise.resolve([over.discountBills || [
        { Id: 'log-1', TransactionNo: 'INV-0001', TransactionDate: '2026-08-01', CustomerName: null, GrossAmount: '1000.00', DiscountAmount: '120.00', ItemDiscountAmount: '70.00', BillDiscountAmount: '50.00' },
      ]]);
    }
    if (/FROM transactionitemdetail/i.test(q)) {
      return Promise.resolve([over.products || [
        { ItemId: 'i1', ItemName: 'Dosa', CategoryName: 'South', QuantitySold: '12', NetAmount: '1200.00', DiscountAmount: '100.00', TaxAmount: '216.00', GrossAmount: '1416.00', Documents: '7' },
      ]]);
    }
    if (/Outstanding\b/i.test(q) && /ORDER BY l\.TransactionDate/i.test(q)) {
      return Promise.resolve([over.unpaid || [
        { Id: 'log-1', TransactionNo: 'INV-0001', GrossAmount: '500.00', Collected: '200.00', Outstanding: '300.00' },
      ]]);
    }
    if (/FROM pos_order/i.test(q)) {
      return Promise.resolve([over.unbilled || [{ Id: 'o1', OrderNo: 'ORD-1', Total: '250.00' }]]);
    }
    if (/FROM paymentbreakup b[\s\S]*JOIN paymentmode/i.test(q)) {
      return Promise.resolve([over.tenders || [
        { PaymentModeId: 'm1', PaymentMode: 'Cash', AccountName: 'Cash', AccountKind: 'ASSET', Tenders: '5', Inflow: '900.00', Outflow: '100.00', NetAmount: '800.00' },
      ]]);
    }
    if (/FROM paymentbreakup b[\s\S]*JOIN accounttypebase/i.test(q)) {
      return Promise.resolve([over.cash || [
        { AccountTypeBaseId: 'a1', AccountName: 'Cash', AccountKind: 'ASSET', Inflow: '900.00', Outflow: '100.00', NetMovement: '800.00' },
        { AccountTypeBaseId: 'a2', AccountName: 'Bank', AccountKind: 'ASSET', Inflow: '400.00', Outflow: '0.00', NetMovement: '400.00' },
      ]]);
    }
    if (/FROM pos_expense/i.test(q)) {
      return Promise.resolve([over.expenses || [
        { ExpenseCategoryId: 'c1', CategoryName: 'Gas', Entries: '2', Amount: '150.00' },
      ]]);
    }
    return Promise.resolve([[]]);
  });
};

const sqlOf = (re) => mockConn.execute.mock.calls.map(([s]) => String(s)).filter((s) => re.test(s));
const allSql = () => mockConn.execute.mock.calls.map(([s]) => String(s)).join('\n');
const paramsOf = (re) => mockConn.execute.mock.calls.find(([s]) => re.test(String(s)))?.[1];

beforeEach(() => { jest.clearAllMocks(); route(); });

describe('sales report — invoiced vs collected', () => {
  it('reads the ledger, never pos_bill', async () => {
    await reports.salesReport({ preset: 'today' }, TENANT);
    expect(allSql()).toMatch(/transactiondetaillog/i);
    expect(allSql()).not.toMatch(/FROM pos_bill/i);
  });

  it('reports collected and outstanding separately from invoiced', async () => {
    // Collapsing these into one "revenue" number is what hides unpaid money.
    const r = await reports.salesReport({ preset: 'today' }, TENANT);
    expect(r.summary.GrossAmount).toBe(354);
    expect(r.summary.Collected).toBe(300);
    expect(r.summary.Outstanding).toBe(54);
  });

  it('coerces DECIMAL strings to numbers', async () => {
    const r = await reports.salesReport({ preset: 'today' }, TENANT);
    expect(typeof r.summary.GrossAmount).toBe('number');
    expect(typeof r.trend[0].GrossAmount).toBe('number');
  });

  it('counts only settled and part-paid documents', async () => {
    await reports.salesReport({ preset: 'today' }, TENANT);
    expect(sqlOf(/SUM\(l\.NetAmount\)/i)[0]).toMatch(/'SETTLED', 'PARTIALLY_PAID'/);
  });

  it('bounds every query by the resolved date range', async () => {
    await reports.salesReport({ preset: 'last5' }, TENANT);
    const params = paramsOf(/SUM\(l\.NetAmount\)/i);
    expect(params).toContain(toISODate(new Date()));
  });

  it('filters to a branch when one is named', async () => {
    await reports.salesReport({ preset: 'today', branchId: 'branch-9' }, TENANT);
    expect(sqlOf(/SUM\(l\.NetAmount\)/i)[0]).toMatch(/l\.BranchId = \?/);
    expect(paramsOf(/SUM\(l\.NetAmount\)/i)).toContain('branch-9');
  });

  it('applies the weekend filter as a predicate on the same window', async () => {
    await reports.salesReport({ preset: 'weekend' }, TENANT);
    expect(sqlOf(/SUM\(l\.NetAmount\)/i)[0]).toMatch(/WEEKDAY\(l\.TransactionDate\) IN \(5, 6\)/);
  });

  it('groups the trend by the requested bucket', async () => {
    await reports.salesReport({ preset: 'month', bucket: 'week' }, TENANT);
    expect(sqlOf(/AS Bucket/i)[0]).toMatch(/YEARWEEK\(l\.TransactionDate, 3\)/);
  });
});

describe('product report — the analytics questions', () => {
  it('answers quantity sold, revenue and DISCOUNT per product', async () => {
    const r = await reports.productReport({ preset: 'week' }, TENANT);
    expect(r.products[0]).toMatchObject({
      ItemName: 'Dosa', QuantitySold: 12, DiscountAmount: 100, GrossAmount: 1416,
    });
  });

  it('reads discount from the stored line column, not a derivation', async () => {
    await reports.productReport({ preset: 'week' }, TENANT);
    expect(sqlOf(/FROM transactionitemdetail/i)[0]).toMatch(/SUM\(ti\.DiscountAmount\)/);
  });

  it('aggregates in SQL — one query, not a range pulled into memory', async () => {
    await reports.productReport({ preset: 'month' }, TENANT);
    expect(mockConn.execute).toHaveBeenCalledTimes(1);
    expect(sqlOf(/FROM transactionitemdetail/i)[0]).toMatch(/GROUP BY ti\.ItemId/);
  });

  it('caps the leaderboard so a report can never dump the catalogue', async () => {
    await reports.productReport({ preset: 'month', limit: 5000 }, TENANT);
    expect(sqlOf(/FROM transactionitemdetail/i)[0]).toMatch(/LIMIT 200/);
  });

  it('narrows to one item or category on request', async () => {
    await reports.productReport({ preset: 'week', itemId: 'item-9', categoryId: 'cat-3' }, TENANT);
    const sql = sqlOf(/FROM transactionitemdetail/i)[0];
    expect(sql).toMatch(/ti\.ItemId = \?/);
    expect(sql).toMatch(/i\.CategoryId = \?/);
  });
});

describe('pending report — two different questions', () => {
  it('separates unpaid (financial) from unbilled (operational)', async () => {
    const r = await reports.pendingReport({ preset: 'week' }, TENANT);
    expect(r.unpaid.totalOutstanding).toBe(300);
    expect(r.unbilled.totalValue).toBe(250);
  });

  it('takes unpaid from the ledger and unbilled from the floor', async () => {
    await reports.pendingReport({ preset: 'week' }, TENANT);
    expect(allSql()).toMatch(/transactiondetaillog/i);
    expect(allSql()).toMatch(/FROM pos_order/i);
  });
});

describe('tender mix — the Z-report', () => {
  it('nets refunds against takings', async () => {
    const r = await reports.tenderReport({ preset: 'today' }, TENANT);
    expect(r.tenders[0]).toMatchObject({ PaymentMode: 'Cash', Inflow: 900, Outflow: 100, NetAmount: 800 });
  });

  it('splices the weekend filter before GROUP BY, not after ORDER BY', async () => {
    await reports.tenderReport({ preset: 'weekend' }, TENANT);
    const sql = sqlOf(/JOIN paymentmode/i)[0];
    expect(sql.indexOf('WEEKDAY')).toBeLessThan(sql.indexOf('GROUP BY'));
  });
});

describe('cash flow — where the money is', () => {
  it('reports only asset accounts', async () => {
    await reports.cashFlowReport({ preset: 'today' }, TENANT);
    expect(sqlOf(/JOIN accounttypebase/i)[0]).toMatch(/a\.Kind = 'ASSET'/);
  });

  it('totals inflow, outflow and net across accounts', async () => {
    const r = await reports.cashFlowReport({ preset: 'today' }, TENANT);
    expect(r.totals).toEqual({ Inflow: 1300, Outflow: 100, NetMovement: 1200 });
  });
});

describe('expense report', () => {
  it('reads settled expense DOCUMENTS, so a draft claim is not a cost', async () => {
    await reports.expenseReport({ preset: 'month' }, TENANT);
    expect(sqlOf(/FROM pos_expense/i)[0]).toMatch(/JOIN transactiondetaillog/i);
  });

  it('totals spend by category', async () => {
    const r = await reports.expenseReport({ preset: 'month' }, TENANT);
    expect(r.totalAmount).toBe(150);
    expect(r.categories[0].CategoryName).toBe('Gas');
  });
});

describe('overview — the daily cash flow question in one call', () => {
  it('nets collected income against settled spend', async () => {
    const r = await reports.overviewReport({ preset: 'today' }, TENANT);
    // Collected (300), not invoiced (354): cash in hand is what was taken.
    expect(r.netPosition).toBe(300 - 150);
  });

  it('is only answerable because expenses post to the same ledger', async () => {
    const r = await reports.overviewReport({ preset: 'today' }, TENANT);
    expect(r.sales).toBeDefined();
    expect(r.expenses.total).toBe(150);
    expect(r.cash.NetMovement).toBe(1200);
  });
});

// The ledger has no idea what a table is, so this report walks backwards
// through pos_bill to find out — and that walk is exactly where it can go wrong.
describe('venue report — which floor and which table earned it', () => {
  it('groups on the round’s frozen venue, not on a live join to pos_table', async () => {
    // Reading pos_table at report time would move last month's revenue whenever
    // a table is renamed or moved upstairs.
    await reports.venueReport({ preset: 'month' }, TENANT);
    const sql = sqlOf(/AS FloorName/)[0];
    expect(sql).toMatch(/o\.FloorName/);
    expect(sql).toMatch(/o\.TableName/);
    expect(sql).not.toMatch(/JOIN pos_floor/i);
  });

  it('apportions a bill across its rounds instead of counting it once per round', async () => {
    // A bill spanning two tables fans this join out; without the apportionment
    // every SUM would be multiplied by the number of rounds.
    await reports.venueReport({ preset: 'month' }, TENANT);
    const sql = sqlOf(/AS FloorName/)[0];
    expect(sql).toMatch(/o\.Total \/ bt\.BillTotal/);
    expect(sql).toMatch(/BillTotal > 0/);
  });

  it('rolls floors up from the same rows the tables came from', async () => {
    // Querying floors separately would let a floor total disagree with the
    // tables listed beneath it.
    const r = await reports.venueReport({ preset: 'month' }, TENANT);
    const ground = r.floors.find((f) => f.FloorId === 'f1');

    expect(ground.GrossAmount).toBe(236 + 118);
    expect(ground.Tables).toBe(2);
    expect(r.totalGross).toBe(236 + 118 + 590);
  });

  it('measures how hard a table works, not just what it took', async () => {
    const r = await reports.venueReport({ preset: 'month' }, TENANT);
    const t1 = r.tables.find((t) => t.TableId === 't1');

    expect(t1.AvgBillValue).toBe(118);          // 236 over 2 bills
    expect(t1.RevenuePerSeat).toBe(59);         // 236 over 4 seats
  });

  it('reports no per-seat figure rather than a fake one when capacity is unknown', async () => {
    route({ venue: [{ FloorId: null, FloorName: 'Unassigned', TableId: null, TableName: 'No table', Capacity: null, Orders: '1', Bills: '1', NetAmount: '100.00', DiscountAmount: '0.00', TaxAmount: '0.00', GrossAmount: '100.00' }] });
    const r = await reports.venueReport({ preset: 'month' }, TENANT);
    expect(r.tables[0].RevenuePerSeat).toBeNull();
  });

  it('counts only settled and part-paid documents', async () => {
    await reports.venueReport({ preset: 'month' }, TENANT);
    expect(sqlOf(/AS FloorName/)[0]).toMatch(/'SETTLED', 'PARTIALLY_PAID'/);
  });

  it('bounds itself by date like every other report', async () => {
    await reports.venueReport({ preset: 'today' }, TENANT);
    expect(paramsOf(/AS FloorName/)).toContain(toISODate(new Date()));
  });

  it('narrows to one floor when asked', async () => {
    await reports.venueReport({ preset: 'month', floorId: 'floor-9' }, TENANT);
    expect(sqlOf(/AS FloorName/)[0]).toMatch(/o\.FloorId = \?/);
    expect(paramsOf(/AS FloorName/)).toContain('floor-9');
  });
});

describe('discount report — what we gave away, and why', () => {
  it('splits the discount decided on a dish from a bill discount’s share', async () => {
    const r = await reports.discountReport({ preset: 'month' }, TENANT);
    expect(r.summary.ItemDiscountAmount).toBe(70);
    expect(r.summary.BillDiscountAmount).toBe(50);
    expect(r.summary.DiscountAmount).toBe(120);
  });

  it('keeps the split adding back to the total, per product', async () => {
    const r = await reports.discountReport({ preset: 'month' }, TENANT);
    r.products.forEach((p) => {
      expect(p.ItemDiscountAmount + p.BillDiscountAmount).toBeCloseTo(p.DiscountAmount, 2);
    });
  });

  it('answers by product AND by bill', async () => {
    const r = await reports.discountReport({ preset: 'month' }, TENANT);
    expect(r.products[0].ItemName).toBe('Dosa');
    expect(r.bills[0].TransactionNo).toBe('INV-0001');
  });

  it('lists only what was actually discounted', async () => {
    await reports.discountReport({ preset: 'month' }, TENANT);
    expect(sqlOf(/ti\.ItemId/)[0]).toMatch(/ti\.DiscountAmount > 0/);
    expect(allSql()).toMatch(/l\.DiscountAmount > 0/);
  });

  it('aggregates in SQL and caps the list', async () => {
    await reports.discountReport({ preset: 'month', limit: 5000 }, TENANT);
    expect(allSql()).toMatch(/LIMIT 200/);
    expect(sqlOf(/ti\.ItemId/)[0]).toMatch(/GROUP BY ti\.ItemId/);
  });
});

// The mix-and-match requirement: the same reports, sliced by venue.
describe('venue filters on the existing reports', () => {
  it('filters sales by floor without fanning the rows out', async () => {
    // A join through pos_bill_order would multiply a multi-round bill into
    // several rows and quietly double every total. EXISTS only filters.
    await reports.salesReport({ preset: 'month', floorId: 'floor-9' }, TENANT);
    const sql = sqlOf(/SUM\(l\.NetAmount\)/)[0];
    expect(sql).toMatch(/AND EXISTS \(/);
    expect(sql).toMatch(/o\.FloorId = \?/);
    expect(paramsOf(/SUM\(l\.NetAmount\)/)).toContain('floor-9');
  });

  it('applies the same filter to the trend, so the two agree', async () => {
    await reports.salesReport({ preset: 'month', tableId: 'table-3' }, TENANT);
    expect(sqlOf(/AS Bucket/)[0]).toMatch(/o\.TableId = \?/);
  });

  it('splices the filter BEFORE the GROUP BY', async () => {
    await reports.salesReport({ preset: 'month', floorId: 'floor-9' }, TENANT);
    const sql = sqlOf(/AS Bucket/)[0];
    expect(sql.indexOf('EXISTS')).toBeLessThan(sql.indexOf('GROUP BY'));
  });

  it('slices products by venue too', async () => {
    await reports.productReport({ preset: 'month', floorId: 'floor-9' }, TENANT);
    expect(sqlOf(/FROM transactionitemdetail/)[0]).toMatch(/o\.FloorId = \?/);
  });

  it('adds nothing at all when no venue is named', async () => {
    await reports.salesReport({ preset: 'month' }, TENANT);
    expect(allSql()).not.toMatch(/EXISTS/);
  });
});
