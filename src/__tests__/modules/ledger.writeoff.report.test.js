// src/__tests__/modules/ledger.writeoff.report.test.js
// The write-off register: balances given up on, by the day they were.
//
// The worked example is the one the design was drawn with — 1 to 6 October:
//   06/10 INV-0009 ₹60.00     Disputed item           Karan
//   05/10 INV-0006 ₹1,000.00  Staff or owner's guest  Karan
//   04/10 INV-0003 ₹5.08      Customer left           Karan
//   02/10 INV-0001 ₹200.00    Customer left           Neha (since removed) — a SEPTEMBER bill
//   01/10 INV-0002 ₹40.00     Other                   Karan
// ₹1,305.08 on 5 bills, ₹200.00 of it on an earlier bill.

jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  captureAudit: jest.fn(),
}));

const mockConn = { execute: jest.fn() };
jest.mock('../../utils/dbHelper', () => ({
  withConnection: jest.fn(async (cb) => cb(mockConn)),
  withTransaction: jest.fn(async (cb) => cb(mockConn)),
}));

const { writeOffReport, maskPhone } = require('../../modules/ledger/ledger.writeoff.report');
const reports = require('../../modules/ledger/ledger.report.service');
const { QUERIES, LEDGER } = require('../../config/constants');
const { toDateTimeBounds } = require('../../utils/dateRange');

const TENANT = 'tenant-1';
const KARAN = '+919000011111';
const NEHA = '+919000022222';
const WINDOW = { preset: 'custom', fromDate: '2026-10-01', toDate: '2026-10-06' };
const day = (d) => new Date(`2026-10-${d}T00:00:00Z`);

const GROUPS = [
  { Reason: 'DISPUTED', WrittenOffBy: KARAN, WrittenOffDay: day('06'), OnEarlierBill: 0, Bills: 1, Amount: '60.0000', Largest: '60.0000' },
  { Reason: 'STAFF_GUEST', WrittenOffBy: KARAN, WrittenOffDay: day('05'), OnEarlierBill: 0, Bills: 1, Amount: '1000.0000', Largest: '1000.0000' },
  { Reason: 'CUSTOMER_LEFT', WrittenOffBy: KARAN, WrittenOffDay: day('04'), OnEarlierBill: 0, Bills: 1, Amount: '5.0800', Largest: '5.0800' },
  { Reason: 'CUSTOMER_LEFT', WrittenOffBy: NEHA, WrittenOffDay: day('02'), OnEarlierBill: 1, Bills: 1, Amount: '200.0000', Largest: '200.0000' },
  { Reason: 'OTHER', WrittenOffBy: KARAN, WrittenOffDay: day('01'), OnEarlierBill: 0, Bills: 1, Amount: '40.0000', Largest: '40.0000' },
];
const ROW = (no, amount, reason, by, over = {}) => ({
  Id: `log-${no}`, TransactionNo: no, TransactionDate: day('04'), GrossAmount: '100.0000',
  CustomerName: null, CustomerMobile: null, BranchId: 'b-1', BranchName: 'Main',
  WriteOffAmount: amount, WriteOffReason: reason, WriteOffNote: null,
  WrittenOffAt: new Date('2026-10-04T07:42:00Z'), WrittenOffBy: by, OnEarlierBill: 0,
  Collected: '50.0000', Returned: '0.0000', TokenLabels: null, TableNames: 'T3', OrderNos: 'ORD-1',
  ...over,
});
const ROWS = [
  ROW('INV-0009', '60.0000', 'DISPUTED', KARAN, { WriteOffNote: 'Dal makhani sent back cold' }),
  ROW('INV-0006', '1000.0000', 'STAFF_GUEST', KARAN),
  ROW('INV-0003', '5.0800', 'CUSTOMER_LEFT', KARAN, { CustomerName: 'slef', GrossAmount: '15.0000', Collected: '9.9200' }),
  ROW('INV-0001', '200.0000', 'CUSTOMER_LEFT', NEHA, {
    TransactionDate: new Date('2026-09-29T00:00:00Z'), OnEarlierBill: 1,
    CustomerName: 'Rahul M.', CustomerMobile: '90000 55555', TokenLabels: 'Token 4', TableNames: null,
  }),
  ROW('INV-0002', '40.0000', 'OTHER', KARAN, { WriteOffNote: 'Card machine down', CustomerName: 'Rahul M.', CustomerMobile: '90000 55555' }),
];

const route = (over = {}) => {
  mockConn.execute.mockImplementation((sql) => {
    const q = String(sql);
    if (/FROM user_tenants/i.test(q)) {
      // Neha has left the tenancy: only Karan still has a membership.
      return Promise.resolve([over.members || [{ id: 'm-karan', user_phone: KARAN, full_name: 'Karan S.' }]]);
    }
    if (/AS WrittenOffDay/i.test(q)) return Promise.resolve([over.groups || GROUPS]);
    if (/l\.WriteOffNote/i.test(q)) return Promise.resolve([over.rows || ROWS]);
    if (/AS Times/i.test(q)) {
      return Promise.resolve([over.repeats || [
        { CustomerName: 'Rahul M.', CustomerMobile: '90000 55555', Times: 2, Amount: '240.0000', LastAt: new Date('2026-10-02T16:00:00Z') },
      ]]);
    }
    if (/AS Invoiced/i.test(q)) return Promise.resolve([[{ Invoiced: over.invoiced ?? '184250.0000' }]]);
    return Promise.resolve([[]]);
  });
};

const callsMatching = (re) => mockConn.execute.mock.calls.filter(([s]) => re.test(String(s)));

beforeEach(() => {
  mockConn.execute.mockReset();
  route();
});

describe('write-off register — which window a write-off falls in', () => {
  it('counts by the day it was written off, bounded by the UTC edges of the local days', async () => {
    await writeOffReport(WINDOW, TENANT);
    const bounds = toDateTimeBounds({ from: '2026-10-01', to: '2026-10-06' });
    [/AS WrittenOffDay/, /l\.WriteOffNote/, /AS Times/].forEach((re) => {
      const [[sql, params]] = callsMatching(re);
      expect(sql).toMatch(/l\.WrittenOffAt BETWEEN \? AND \?/);
      expect(sql).not.toMatch(/l\.TransactionDate BETWEEN/);
      expect(params).toEqual(expect.arrayContaining([TENANT, LEDGER.TYPE_POS_SALE, bounds.from, bounds.to]));
    });
  });

  it('marks a bill dated before the window, so an earlier bill can be told apart', async () => {
    await writeOffReport(WINDOW, TENANT);
    const [[sql, params]] = callsMatching(/AS WrittenOffDay/);
    expect(sql).toMatch(/CASE WHEN l\.TransactionDate < \? THEN 1 ELSE 0 END AS OnEarlierBill/);
    expect(params[0]).toBe('2026-10-01');
  });

  it('reads only sales that were actually written off', async () => {
    await writeOffReport(WINDOW, TENANT);
    const [[sql]] = callsMatching(/l\.WriteOffNote/);
    expect(sql).toMatch(/l\.WriteOffAmount > 0/);
    expect(sql).toMatch(/ORDER BY l\.WrittenOffAt DESC/);
  });

  it('buckets the trend by LOCAL day, shifting the UTC instant back first', async () => {
    await writeOffReport(WINDOW, TENANT);
    const [[sql]] = callsMatching(/AS WrittenOffDay/);
    expect(sql).toMatch(/DATE\(\(l\.WrittenOffAt \+ INTERVAL -?\d+ MINUTE\)\)\s+AS WrittenOffDay/);
  });

  it('reads a weekend-only window on the local day of the write-off', async () => {
    await writeOffReport({ preset: 'weekend' }, TENANT);
    const [[sql]] = callsMatching(/AS WrittenOffDay/);
    expect(sql).toMatch(/WEEKDAY\(l\.WrittenOffAt \+ INTERVAL -?\d+ MINUTE\) IN \(5, 6\)/);
  });

  it('applies a branch bound to every read, the invoiced denominator included', async () => {
    await writeOffReport({ ...WINDOW, branchId: 'b-1' }, TENANT);
    [/AS WrittenOffDay/, /l\.WriteOffNote/, /AS Times/, /AS Invoiced/].forEach((re) => {
      const [[sql, params]] = callsMatching(re);
      expect(sql).toMatch(/l\.BranchId = \?/);
      expect(params).toContain('b-1');
    });
  });

  it('reads invoiced by BILL date, as every sales figure is', async () => {
    await writeOffReport(WINDOW, TENANT);
    const [[sql, params]] = callsMatching(/AS Invoiced/);
    expect(sql).toMatch(/l\.TransactionDate BETWEEN \? AND \?/);
    expect(params).toEqual([TENANT, LEDGER.TYPE_POS_SALE, '2026-10-01', '2026-10-06']);
  });
});

describe('write-off register — the totals', () => {
  it('adds up to the paisa, with the earlier-bills part split out', async () => {
    const r = await writeOffReport(WINDOW, TENANT);
    expect(r.summary).toMatchObject({
      WrittenOff: 1305.08,
      Bills: 5,
      Average: 261.02,
      Largest: 1000,
      LargestNo: 'INV-0006',
      LargestReason: "Staff or owner's guest",
      OnEarlierBills: 200,
      EarlierBills: 1,
      // Exactly Invoiced − Collected − Outstanding for the window's own bills.
      OnThisPeriodBills: 1105.08,
      Invoiced: 184250,
      ShareOfInvoiced: 0.71,
    });
  });

  it('splits by reason, biggest first, with labels a person can read', async () => {
    const { byReason } = await writeOffReport(WINDOW, TENANT);
    expect(byReason.map((r) => [r.Code, r.Bills, r.Amount])).toEqual([
      ['STAFF_GUEST', 1, 1000],
      ['CUSTOMER_LEFT', 2, 205.08],
      ['DISPUTED', 1, 60],
      ['OTHER', 1, 40],
    ]);
    expect(byReason[1].Label).toBe('Customer left without paying');
    expect(byReason[0].Share).toBe(76.62);
  });

  it('fills a quiet day with ₹0 rather than dropping it from the trend', async () => {
    const { byDay } = await writeOffReport(WINDOW, TENANT);
    expect(byDay.map((d) => [d.Bucket, d.Amount])).toEqual([
      ['2026-10-01', 40], ['2026-10-02', 200], ['2026-10-03', 0],
      ['2026-10-04', 5.08], ['2026-10-05', 1000], ['2026-10-06', 60],
    ]);
  });

  it('a window with no write-offs is all zeros and asks nobody’s name', async () => {
    route({ groups: [], rows: [], repeats: [], invoiced: '0' });
    const r = await writeOffReport(WINDOW, TENANT);
    expect(r.summary).toMatchObject({ WrittenOff: 0, Bills: 0, Average: 0, Largest: 0, ShareOfInvoiced: 0 });
    expect(r.byReason).toEqual([]);
    expect(r.documents).toEqual([]);
    expect(callsMatching(/FROM user_tenants/)).toHaveLength(0);
  });
});

describe('write-off register — who wrote it off', () => {
  it('names the member, and masks someone no longer in the tenancy', async () => {
    const { byUser, documents } = await writeOffReport(WINDOW, TENANT);
    expect(byUser.map((u) => [u.Name, u.Bills, u.Amount])).toEqual([
      ['Karan S.', 4, 1105.08],
      ['•••• 2222', 1, 200],
    ]);
    expect(byUser[0].Key).toBe('m-karan');
    expect(documents.find((d) => d.TransactionNo === 'INV-0001').WrittenOffByName).toBe('•••• 2222');
  });

  it('never sends the mobile of whoever wrote it off', async () => {
    const r = await writeOffReport(WINDOW, TENANT);
    const json = JSON.stringify(r);
    expect(json).not.toContain(KARAN);
    expect(json).not.toContain(NEHA);
  });

  it('looks every name up in one read, bounded by the tenancy', async () => {
    await writeOffReport(WINDOW, TENANT);
    const calls = callsMatching(/FROM user_tenants/);
    expect(calls).toHaveLength(1);
    expect(calls[0][1]).toEqual([TENANT, KARAN, NEHA]);
  });

  it('does not pass on a "name" that is really the member\'s mobile', async () => {
    // Sign-in stores the number as full_name when nobody typed a name.
    route({ members: [{ id: 'm-karan', user_phone: KARAN, full_name: KARAN }] });
    const r = await writeOffReport(WINDOW, TENANT);
    expect(r.byUser[0]).toMatchObject({ Key: 'm-karan', Name: '•••• 1111' });
    expect(JSON.stringify(r)).not.toContain(KARAN);
  });

  it('masks a mobile to its last four digits', () => {
    expect(maskPhone('+91 90000 12345')).toBe('•••• 2345');
    expect(maskPhone('')).toBe('Former member');
  });
});

describe('write-off register — the rows', () => {
  it('carries what the list and the detail need, newest first', async () => {
    const { documents } = await writeOffReport(WINDOW, TENANT);
    expect(documents.map((d) => d.TransactionNo)).toEqual(['INV-0009', 'INV-0006', 'INV-0003', 'INV-0001', 'INV-0002']);
    expect(documents[2]).toMatchObject({
      CustomerName: 'slef', GrossAmount: 15, Collected: 9.92, WrittenOff: 5.08,
      Reason: 'CUSTOMER_LEFT', ReasonLabel: 'Customer left without paying',
      WrittenOffByName: 'Karan S.', OnEarlierBill: false,
      Source: { kind: 'table', label: 'T3' },
    });
    expect(documents[3]).toMatchObject({ OnEarlierBill: true, Source: { kind: 'token', label: 'Token 4' } });
    expect(documents[0].Note).toBe('Dal makhani sent back cold');
  });

  it('lists names written off more than once', async () => {
    const { repeats } = await writeOffReport(WINDOW, TENANT);
    expect(repeats).toEqual([expect.objectContaining({ CustomerName: 'Rahul M.', Times: 2, Amount: 240 })]);
    const [[sql]] = callsMatching(/AS Times/);
    expect(sql).toMatch(/HAVING COUNT\(\*\) > 1/);
  });
});

describe('write-offs elsewhere', () => {
  it('Finance overview carries the same summary, its reasons and the latest three', async () => {
    const r = await reports.overviewReport(WINDOW, TENANT);
    expect(r.writeOffs).toMatchObject({ WrittenOff: 1305.08, Bills: 5, OnThisPeriodBills: 1105.08 });
    expect(r.writeOffs.byReason).toHaveLength(4);
    expect(r.writeOffs.latest.map((d) => d.TransactionNo)).toEqual(['INV-0009', 'INV-0006', 'INV-0003']);
  });

  it('a write-off is stamped as a UTC instant, the frame the register reads it in', () => {
    expect(QUERIES.LEDGER.SET_WRITE_OFF).toMatch(/WrittenOffAt = UTC_TIMESTAMP\(\)/);
  });
});
