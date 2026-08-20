// Counter queue statistics: how long people stood there, not what they paid.
//
// Lives outside the ledger reporting engine on purpose — that engine's one
// invariant is that every figure comes from the ledger, and a token is
// operational state. These tests hold that separation in place.

jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  captureAudit: jest.fn(),
}));

const mockConn = { execute: jest.fn() };
jest.mock('../../utils/dbHelper', () => ({
  withConnection: async (cb) => cb(mockConn),
}));

const reports = require('../../modules/postoken/postoken.report.service');

const TENANT = 'tenant-1';

const route = (over = {}) => {
  mockConn.execute.mockImplementation((sql) => {
    if (/AS Bucket/i.test(String(sql))) {
      return Promise.resolve([over.trend || [
        { Bucket: '2026-08-16', Issued: '12', Served: '11', AvgWaitSeconds: '240.0' },
      ]]);
    }
    return Promise.resolve([[over.summary || {
      Issued: '12', Served: '10', Waiting: '1', Called: '1', Cancelled: '0',
      AvgWaitSeconds: '270.0', MaxWaitSeconds: '900.0', AvgCollectSeconds: '45.0',
    }]]);
  });
};

const sqlOf = (re) => mockConn.execute.mock.calls.map(([s]) => String(s)).filter((s) => re.test(s));
const allSql = () => mockConn.execute.mock.calls.map(([s]) => String(s)).join('\n');
const paramsOf = (re) => mockConn.execute.mock.calls.find(([s]) => re.test(String(s)))?.[1];

beforeEach(() => { jest.clearAllMocks(); route(); });

describe('queue statistics', () => {
  it('reads pos_token and nothing else — this is not a ledger report', async () => {
    await reports.queueStats({ preset: 'today' }, TENANT);
    expect(allSql()).toMatch(/FROM pos_token/);
    expect(allSql()).not.toMatch(/transactiondetaillog|pos_bill/i);
  });

  it('bounds itself by TokenDate, the column the queue is keyed on', async () => {
    await reports.queueStats({ preset: 'today' }, TENANT);
    expect(allSql()).toMatch(/TokenDate BETWEEN \? AND \?/);
  });

  it('is scoped to the tenant', async () => {
    await reports.queueStats({ preset: 'today' }, TENANT);
    expect(paramsOf(/FROM pos_token/)[0]).toBe(TENANT);
  });

  it('narrows to one branch when asked', async () => {
    await reports.queueStats({ preset: 'today', branchId: 'br-1' }, TENANT);
    expect(sqlOf(/FROM pos_token/)[0]).toMatch(/BranchDetailId = \?/);
    expect(paramsOf(/FROM pos_token/)).toContain('br-1');
  });

  it('aggregates in SQL rather than pulling a range into memory', async () => {
    await reports.queueStats({ preset: 'month' }, TENANT);
    expect(allSql()).toMatch(/COUNT\(\*\)/);
    expect(allSql()).toMatch(/AVG\(/);
  });

  // A wait that has not ended is not a short wait. Averaging it in as zero
  // would flatter every number on the screen.
  it('measures a wait only where both ends exist', async () => {
    await reports.queueStats({ preset: 'today' }, TENANT);
    const sql = sqlOf(/AVG\(/)[0];
    expect(sql).toMatch(/CASE WHEN CalledAt IS NOT NULL/);
  });

  // Merging them would blame the kitchen for a customer who wandered off.
  it('keeps waiting-to-be-called apart from called-to-collected', async () => {
    await reports.queueStats({ preset: 'today' }, TENANT);
    const sql = sqlOf(/AVG\(/)[0];
    expect(sql).toMatch(/TIMESTAMPDIFF\(SECOND, CreatedOn, CalledAt\)/);
    expect(sql).toMatch(/TIMESTAMPDIFF\(SECOND, CalledAt, ServedAt\)/);
  });

  it('reports waits in minutes — the unit a human reads', async () => {
    const r = await reports.queueStats({ preset: 'today' }, TENANT);
    expect(r.summary.AvgWaitMinutes).toBe(4.5);   // 270s
    expect(r.summary.MaxWaitMinutes).toBe(15);    // 900s
    expect(r.summary.AvgCollectMinutes).toBe(0.8); // 45s
  });

  it('coerces the counts MySQL returns as strings', async () => {
    const r = await reports.queueStats({ preset: 'today' }, TENANT);
    expect(r.summary.Issued).toBe(12);
    expect(r.summary.Served).toBe(10);
    expect(r.trend[0].Issued).toBe(12);
  });

  // Nothing issued is a legitimate day, not an error.
  it('returns zeroes and null waits for an empty range', async () => {
    route({ summary: {
      Issued: null, Served: null, Waiting: null, Called: null, Cancelled: null,
      AvgWaitSeconds: null, MaxWaitSeconds: null, AvgCollectSeconds: null,
    }, trend: [] });

    const r = await reports.queueStats({ preset: 'today' }, TENANT);
    expect(r.summary.Issued).toBe(0);
    // Null, not zero: "no waits recorded" and "waits averaged zero" are
    // different facts, and the screen renders them differently.
    expect(r.summary.AvgWaitMinutes).toBeNull();
    expect(r.trend).toEqual([]);
  });

  it('shares the ledger reports’ date vocabulary', async () => {
    // One resolver on both sides of the Finance screen, so "last weekend"
    // cannot mean two different windows.
    const r = await reports.queueStats({ preset: 'month' }, TENANT);
    expect(r.range).toHaveProperty('from');
    expect(r.range).toHaveProperty('to');
  });
});
