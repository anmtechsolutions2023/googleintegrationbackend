// src/__tests__/modules/poscashsession.service.test.js
// A till session exists to answer one question: is the drawer short, and whose
// shift was it? These tests pin the derivation of expected cash and the two
// guards that keep the answer meaningful.

jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  captureAudit: jest.fn(),
}));

let mockUuidCounter = 0;
jest.mock('uuid', () => ({ v4: jest.fn(() => `uuid-${++mockUuidCounter}`) }));

const mockConn = { execute: jest.fn() };
jest.mock('../../utils/dbHelper', () => ({
  withConnection: jest.fn(async (cb) => cb(mockConn)),
  withTransaction: jest.fn(async (cb) => cb(mockConn)),
}));

const service = require('../../modules/poscashsession/poscashsession.service');

const TENANT = 'tenant-1';
const USER = 'cashier@test.com';
const SESSION_ID = 'sess-1';

const SESSION = (over = {}) => ({
  Id: SESSION_ID,
  BranchDetailId: 'branch-1',
  CashierPhone: USER,
  ShiftLabel: 'Morning',
  OpeningFloat: '1000.00',
  OpenedAt: '2026-08-01 09:00:00',
  ClosedAt: null,
  Status: 'open',
  ...over,
});

const route = (over = {}) => {
  mockConn.execute.mockImplementation((sql) => {
    const q = String(sql);
    if (/Status = 'open' LIMIT 1/i.test(q) && /CashierPhone/i.test(q)) {
      return Promise.resolve([over.openForCashier || []]);
    }
    // SELECT-anchored: the CLOSE statement also ends in Status = 'open', and
    // answering it with a row would hide the zero-rows-updated race guard.
    if (/^\s*SELECT \* FROM pos_cash_session WHERE Id/i.test(q)) {
      return Promise.resolve([over.openById === undefined ? [SESSION()] : over.openById]);
    }
    if (/AS NetCash/i.test(q)) {
      return Promise.resolve([[{ NetCash: over.netCash ?? '2500.00' }]]);
    }
    if (/FROM pos_cash_session cs/i.test(q)) {
      return Promise.resolve([[SESSION(over.row || {})]]);
    }
    if (/^\s*SELECT/i.test(q)) return Promise.resolve([[]]);
    return Promise.resolve([{ affectedRows: over.affectedRows ?? 1 }]);
  });
};

const callsTo = (re) => mockConn.execute.mock.calls.filter(([s]) => re.test(String(s)));

beforeEach(() => { jest.clearAllMocks(); mockUuidCounter = 0; });

describe('opening a till', () => {
  it('records the cashier, shift and opening float', async () => {
    route();
    await service.open(
      { BranchDetailId: 'branch-1', ShiftLabel: 'Morning', OpeningFloat: 1000 },
      TENANT, USER,
    );
    const [, params] = callsTo(/INSERT INTO pos_cash_session/i)[0];
    expect(params).toEqual(expect.arrayContaining(['branch-1', USER, 'Morning', 1000]));
  });

  it('defaults the cashier to whoever opened it', async () => {
    route();
    await service.open({ BranchDetailId: 'branch-1' }, TENANT, USER);
    expect(callsTo(/INSERT INTO pos_cash_session/i)[0][1]).toContain(USER);
  });

  it('refuses a second open till for the same cashier at the same branch', async () => {
    // Per shift per cashier is the whole point: one daily row could not say
    // whose count was short.
    route({ openForCashier: [{ Id: 'already-open' }] });
    await expect(service.open({ BranchDetailId: 'branch-1' }, TENANT, USER))
      .rejects.toMatchObject({ statusCode: 409 });
  });

  it('writes nothing when a till is already open', async () => {
    route({ openForCashier: [{ Id: 'already-open' }] });
    await service.open({ BranchDetailId: 'branch-1' }, TENANT, USER).catch(() => {});
    expect(callsTo(/INSERT INTO pos_cash_session/i)).toHaveLength(0);
  });
});

describe('expected cash — derived, never tallied as it goes', () => {
  it('is the opening float plus every cash movement in the window', async () => {
    route({ netCash: '2500.00' });
    const expected = await service.expectedCash(mockConn, SESSION(), TENANT);
    expect(expected).toBe(3500); // 1000 float + 2500 net cash
  });

  it('subtracts outflows, because expenses are negative rows in the same table', async () => {
    route({ netCash: '-300.00' });
    const expected = await service.expectedCash(mockConn, SESSION(), TENANT);
    expect(expected).toBe(700);
  });

  it('reads only the Cash account, not card or UPI takings', async () => {
    route();
    await service.expectedCash(mockConn, SESSION(), TENANT);
    expect(callsTo(/AS NetCash/i)[0][0]).toMatch(/a\.Name = 'Cash'/);
  });

  it('bounds the movement query by the session window', async () => {
    route();
    await service.expectedCash(mockConn, SESSION(), TENANT);
    const params = callsTo(/AS NetCash/i)[0][1];
    expect(params).toContain('2026-08-01 09:00:00');
  });
});

describe('closing a till', () => {
  it('records counted, expected and the variance between them', async () => {
    route({ netCash: '2500.00' });
    await service.close(SESSION_ID, { CountedCash: 3400 }, TENANT, USER);
    const [, params] = callsTo(/SET ClosedAt = NOW\(\)/i)[0];
    // [ClosedBy, Counted, Expected, Variance, Notes, UpdatedBy, Id, TenantId]
    expect(params[1]).toBe(3400);
    expect(params[2]).toBe(3500);
    expect(params[3]).toBe(-100); // short by 100 — the number to explain
  });

  it('does NOT correct the count to match the expectation', async () => {
    route({ netCash: '2500.00' });
    await service.close(SESSION_ID, { CountedCash: 3400 }, TENANT, USER);
    const [, params] = callsTo(/SET ClosedAt = NOW\(\)/i)[0];
    expect(params[1]).not.toBe(params[2]);
  });

  it('reports a surplus as a positive variance', async () => {
    route({ netCash: '2500.00' });
    await service.close(SESSION_ID, { CountedCash: 3550 }, TENANT, USER);
    expect(callsTo(/SET ClosedAt = NOW\(\)/i)[0][1][3]).toBe(50);
  });

  it('refuses to close a session that is not open', async () => {
    route({ openById: [] });
    await expect(service.close(SESSION_ID, { CountedCash: 100 }, TENANT, USER))
      .rejects.toMatchObject({ statusCode: 409 });
  });

  it('refuses a double close even if two requests race past the read', async () => {
    // The UPDATE carries Status = 'open', so the loser updates zero rows.
    route({ affectedRows: 0 });
    await expect(service.close(SESSION_ID, { CountedCash: 100 }, TENANT, USER))
      .rejects.toMatchObject({ statusCode: 409 });
  });

  it('guards the close with a Status predicate, not just a prior read', async () => {
    route();
    await service.close(SESSION_ID, { CountedCash: 100 }, TENANT, USER);
    expect(callsTo(/SET ClosedAt = NOW\(\)/i)[0][0]).toMatch(/Status = 'open'/);
  });
});

describe('mid-shift summary', () => {
  it('reports live expected cash for an open till', async () => {
    route({ netCash: '500.00' });
    const s = await service.summary(SESSION_ID, TENANT);
    expect(s.ExpectedCash).toBe(1500);
    expect(s.IsOpen).toBe(true);
  });

  it('reports the stored figure once the till is closed', async () => {
    route({ row: { Status: 'closed', ExpectedCash: '4321.00', ClosedAt: '2026-08-01 18:00:00' } });
    const s = await service.summary(SESSION_ID, TENANT);
    expect(s.ExpectedCash).toBe(4321);
    expect(s.IsOpen).toBe(false);
  });
});
