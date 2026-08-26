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
    // ── Customer shapes ────────────────────────────────────────────────────
    if (/AS AvgDaysBetween/i.test(q)) {
      return Promise.resolve([over.customers || [
        { Id: 'c1', Name: 'Priya R', Phone: '9876543210', LoyaltyPoints: '20', LastVisitAt: '2026-08-20',
          Orders: '4', Spend: '4000.00', AverageOrder: '1000.00', FirstVisit: '2026-08-01',
          LastOrder: '2026-08-20', DaysSinceLast: '6', AvgDaysBetween: '6.3' },
        { Id: 'c2', Name: 'Arjun', Phone: null, LoyaltyPoints: '2', LastVisitAt: '2026-08-10',
          Orders: '1', Spend: '250.00', AverageOrder: '250.00', FirstVisit: '2026-08-10',
          LastOrder: '2026-08-10', DaysSinceLast: '16', AvgDaysBetween: null },
      ]]);
    }
    if (/AS KnownCustomers/i.test(q)) {
      return Promise.resolve([[over.repeat || {
        KnownCustomers: '2', RepeatCustomers: '1', KnownOrders: '5', KnownSpend: '4250.00',
      }]]);
    }
    // `AS Gross` with a word boundary — every other report aliases GrossAmount,
    // so this matches the walk-in-inclusive denominator and nothing else.
    if (/AS Gross\b/i.test(q)) {
      return Promise.resolve([[over.totals || { Documents: '10', Gross: '9000.00' }]]);
    }
    if (/AS Dow/i.test(q)) {
      return Promise.resolve([over.pattern || [
        { Dow: '4', Hour: '13', Visits: '2', Spend: '400.00' },
        { Dow: '4', Hour: '20', Visits: '7', Spend: '2100.00' },
        { Dow: '6', Hour: '20', Visits: '5', Spend: '1500.00' },
      ]]);
    }
    if (/AS DaysSince/i.test(q)) {
      return Promise.resolve([over.lapsed || [
        { Id: 'c9', Name: 'Meera', Phone: '90000', Visits: '8', TotalSpent: '9000.00',
          LoyaltyPoints: '40', LastVisitAt: '2026-05-01', DaysSince: '117' },
      ]]);
    }
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
    // Channel, venue and discount shapes are matched BEFORE the generic ones —
    // they read the same tables, and the broader patterns below would swallow
    // them. Channel comes first: it shares its whole join with the venue query.
    if (/AS Channel/i.test(q)) {
      return Promise.resolve([over.channels || [
        { Channel: 'Dine-in',  Orders: '6', Bills: '4', NetAmount: '800.00', DiscountAmount: '20.00', TaxAmount: '144.00', GrossAmount: '944.00' },
        { Channel: 'Counter',  Orders: '9', Bills: '9', NetAmount: '400.00', DiscountAmount: '0.00',  TaxAmount: '72.00',  GrossAmount: '472.00' },
        { Channel: 'Delivery', Orders: '2', Bills: '2', NetAmount: '200.00', DiscountAmount: '0.00',  TaxAmount: '36.00',  GrossAmount: '236.00' },
      ]]);
    }
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
/** Same money rounding the service applies, so expectations state the rule. */
const round2 = (v) => Math.round(v * 100) / 100;
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
// Counter sales were always in the totals — a counter bill posts the same
// ledger document as any other — but nothing could NAME them, so "how much came
// over the counter today?" had no answer.
describe('channel report — where the sale happened', () => {
  it('classifies on the round, with the table winning over the order type', async () => {
    // Same rule that decides whether a token is issued at settle time: a round
    // seated at a table is dine-in revenue whatever it was typed as. If the two
    // disagreed, a sale could get a counter token and be reported as dine-in.
    await reports.channelReport({ preset: 'month' }, TENANT);
    const sql = sqlOf(/AS Channel/)[0];
    expect(sql).toMatch(/WHEN o\.TableId IS NOT NULL THEN 'Dine-in'/);
    expect(sql).toMatch(/'takeaway' THEN 'Counter'/);
    expect(sql).toMatch(/'delivery' THEN 'Delivery'/);
  });

  it('apportions a bill across its rounds, exactly as the venue report does', async () => {
    // The two reports slice the same money. Sharing the join is what stops them
    // disagreeing about the same bill.
    await reports.channelReport({ preset: 'month' }, TENANT);
    const channelSql = sqlOf(/AS Channel/)[0];
    await reports.venueReport({ preset: 'month' }, TENANT);
    const venueSql = sqlOf(/AS FloorName/)[0];

    expect(channelSql).toMatch(/o\.Total \/ bt\.BillTotal/);
    // The shared join is byte-identical, not merely similar — the two reports
    // differ only in what they project and group by.
    const join = (sql) => {
      const from = sql.indexOf('FROM transactiondetaillog');
      const end = sql.indexOf("PARTIALLY_PAID')") + "PARTIALLY_PAID')".length;
      return sql.slice(from, end);
    };
    expect(join(channelSql)).toBe(join(venueSql));
  });

  it('reads only settled and part-paid documents', async () => {
    await reports.channelReport({ preset: 'month' }, TENANT);
    expect(sqlOf(/AS Channel/)[0]).toMatch(/s\.Name IN \('SETTLED', 'PARTIALLY_PAID'\)/);
  });

  it('reports each channel’s share of revenue', async () => {
    const r = await reports.channelReport({ preset: 'month' }, TENANT);
    const total = 944 + 472 + 236;
    const counter = r.channels.find((c) => c.Channel === 'Counter');

    expect(r.totalGross).toBe(total);
    expect(counter.ShareOfRevenue).toBe(round2((472 / total) * 100));
    expect(r.channels.reduce((s, c) => s + c.ShareOfRevenue, 0)).toBeCloseTo(100, 1);
  });

  it('gives each channel an average bill — the number that makes them comparable', async () => {
    const r = await reports.channelReport({ preset: 'month' }, TENANT);
    const counter = r.channels.find((c) => c.Channel === 'Counter');
    const dinein = r.channels.find((c) => c.Channel === 'Dine-in');

    expect(counter.AvgBillValue).toBe(round2(472 / 9));
    expect(dinein.AvgBillValue).toBe(round2(944 / 4));
  });

  it('divides by zero nowhere when the range is empty', async () => {
    route({ channels: [] });
    const r = await reports.channelReport({ preset: 'month' }, TENANT);
    expect(r.totalGross).toBe(0);
    expect(r.channels).toEqual([]);
  });

  it('accepts the shared branch and venue bounds', async () => {
    await reports.channelReport({ preset: 'month', branchId: 'br-1', floorId: 'f-1' }, TENANT);
    const sql = sqlOf(/AS Channel/)[0];
    expect(sql).toMatch(/l\.BranchId = \?/);
    expect(sql).toMatch(/o\.FloorId = \?/);
  });
});

// A table-less round used to collapse into one anonymous 'No table' row holding
// counter and delivery together — a bucket that grows with counter volume while
// reading like a floor-plan gap.
describe('venue report — table-less rounds are named by channel', () => {
  it('labels a round with no table by its channel', async () => {
    await reports.venueReport({ preset: 'month' }, TENANT);
    const sql = sqlOf(/AS FloorName/)[0];
    expect(sql).toMatch(/COALESCE\(o\.TableName,\s*\n?\s*CASE/);
    expect(sql).not.toMatch(/'No table'/);
  });

  // `TableName` in a GROUP BY resolves to the real pos_order column of that
  // name, NOT to the aliased expression — which leaves o.OrderType ungrouped
  // and fails outright under only_full_group_by. The expression has to be
  // repeated. Mocked tests cannot catch this; the database can and did.
  it('groups by the channel expression itself, never by the alias', async () => {
    await reports.venueReport({ preset: 'month' }, TENANT);
    const sql = sqlOf(/AS FloorName/)[0];
    const groupBy = sql.slice(sql.indexOf('GROUP BY'));
    expect(groupBy).toMatch(/COALESCE\(o\.TableName,\s*\n?\s*CASE/);
    expect(groupBy).not.toMatch(/GROUP BY o\.FloorId, FloorName, o\.TableId, TableName/);
  });
});

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


// ── Who bought, and can we count on them ───────────────────────────────────
// Ten reports answer WHAT was sold. These three answer WHO bought it, which is
// the question a loyalty programme is actually built on.
describe('customer report — credibility and repeat history', () => {
  it('reads settled documents, not pos_order', async () => {
    // An order placed and never paid for is not a visit. Counting it would
    // flatter every regular in the tenancy.
    await reports.customerReport({ preset: 'month' }, TENANT);
    const sql = sqlOf(/AS AvgDaysBetween/)[0];
    expect(sql).toMatch(/transactiondetaillog/);
  });

  it('excludes a REFUNDED sale from every part of the report', async () => {
    // The refund already reversed the visit, the spend and the points. A
    // report that still counted it would contradict the customer record.
    await reports.customerReport({ preset: 'month' }, TENANT);
    ['AS AvgDaysBetween', 'AS KnownCustomers', 'AS Documents'].forEach((shape) => {
      expect(sqlOf(new RegExp(shape))[0]).toMatch(/'SETTLED', 'PARTIALLY_PAID'/);
    });
  });

  it('measures the identified rate against ALL sales, walk-ins included', async () => {
    // Computed over known customers only, a repeat rate always looks wonderful.
    const r = await reports.customerReport({ preset: 'month' }, TENANT);
    expect(r.summary.Documents).toBe(10);
    expect(r.summary.IdentifiedRate).toBe(50); // 5 known orders of 10 documents
  });

  it('reports the repeat rate over known customers', async () => {
    const r = await reports.customerReport({ preset: 'month' }, TENANT);
    expect(r.summary.RepeatRate).toBe(50); // 1 of 2
  });

  it('leaves a one-time buyer with no visit interval', async () => {
    // 0 would read as "comes every day" — the opposite of the truth.
    const r = await reports.customerReport({ preset: 'month' }, TENANT);
    expect(r.customers.find((c) => c.Name === 'Arjun').AvgDaysBetween).toBeNull();
    expect(r.customers.find((c) => c.Name === 'Priya R').AvgDaysBetween).toBe(6.3);
  });

  it('marks who is a repeat customer', async () => {
    const r = await reports.customerReport({ preset: 'month' }, TENANT);
    expect(r.customers.map((c) => c.IsRepeat)).toEqual([true, false]);
  });

  it('narrows to one customer on request', async () => {
    await reports.customerReport({ preset: 'month', customerId: 'c1' }, TENANT);
    expect(sqlOf(/AS AvgDaysBetween/)[0]).toMatch(/c\.Id = \?/);
    expect(paramsOf(/AS AvgDaysBetween/)).toContain('c1');
  });

  it('filters out anyone below minOrders', async () => {
    const r = await reports.customerReport({ preset: 'month', minOrders: 2 }, TENANT);
    expect(r.customers.map((c) => c.Name)).toEqual(['Priya R']);
  });

  it('interpolates the row cap instead of binding it', async () => {
    // LIMIT cannot be bound through mysqld_stmt_execute — binding it fails the
    // whole report with ER_WRONG_ARGUMENTS.
    await reports.customerReport({ preset: 'month', limit: 25 }, TENANT);
    expect(sqlOf(/AS AvgDaysBetween/)[0]).toMatch(/LIMIT 25/);
    expect(paramsOf(/AS AvgDaysBetween/)).not.toContain(25);
  });

  it('caps the row count however large a limit is asked for', async () => {
    await reports.customerReport({ preset: 'month', limit: 99999 }, TENANT);
    expect(sqlOf(/AS AvgDaysBetween/)[0]).toMatch(/LIMIT 500/);
  });
});

describe('visit pattern — when they actually come in', () => {
  it('returns the grid and both axes already totalled', async () => {
    const r = await reports.visitPatternReport({ preset: 'month' }, TENANT);
    expect(r.cells).toHaveLength(3);
    expect(r.byDay).toHaveLength(7);   // every day, including the quiet ones
    expect(r.byHour).toHaveLength(24);
  });

  it('names the day rather than leaving the caller to decode DAYOFWEEK', async () => {
    const r = await reports.visitPatternReport({ preset: 'month' }, TENANT);
    expect(r.cells[0].Day).toBe('Wednesday'); // MySQL DAYOFWEEK: 1 = Sunday
  });

  it('picks out the single busiest slot', async () => {
    const r = await reports.visitPatternReport({ preset: 'month' }, TENANT);
    expect(r.Busiest).toEqual({ Day: 'Wednesday', Hour: 20, Visits: 7 });
  });

  it('has no busiest slot when nothing was sold', async () => {
    route({ pattern: [] });
    const r = await reports.visitPatternReport({ preset: 'month' }, TENANT);
    expect(r.Busiest).toBeNull();
  });

  it('excludes refunded sales here too', async () => {
    await reports.visitPatternReport({ preset: 'month' }, TENANT);
    expect(sqlOf(/AS Dow/)[0]).toMatch(/'SETTLED', 'PARTIALLY_PAID'/);
  });
});

describe('lapsed customers — a targeting list, not a chart', () => {
  it('sorts by lifetime spend, not by recency', async () => {
    // The customer worth winning back is not the one who came most recently.
    await reports.lapsedReport({ days: 30 }, TENANT);
    expect(sqlOf(/AS DaysSince/)[0]).toMatch(/ORDER BY TotalSpent DESC/);
  });

  it('defaults to a 30-day threshold', async () => {
    const r = await reports.lapsedReport({}, TENANT);
    expect(r.thresholdDays).toBe(30);
  });

  it('clamps an absurd threshold instead of returning nonsense', async () => {
    expect((await reports.lapsedReport({ days: 99999 }, TENANT)).thresholdDays).toBe(365);
    expect((await reports.lapsedReport({ days: 0 }, TENANT)).thresholdDays).toBe(30);
  });

  it('returns money as numbers, not strings', async () => {
    const r = await reports.lapsedReport({ days: 30 }, TENANT);
    expect(r.customers[0].TotalSpent).toBe(9000);
    expect(r.customers[0].DaysSince).toBe(117);
  });
});
