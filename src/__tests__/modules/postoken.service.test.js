// Counter tokens: how a number is minted, and what it is minted from.
//
// The number used to be computed in the browser as Math.max(...loadedTokens)+1,
// so two tills issued #7 at once — and with BranchDetailId left NULL the unique
// key could not catch it, because MySQL treats NULLs as distinct in a unique
// index. Everything below exists to hold the server-side replacement in place.

jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  captureAudit: jest.fn(),
}));
jest.mock('uuid', () => ({ v4: jest.fn(() => 'mock-uuid') }));

let state;
const executed = [];
const mockConn = {
  execute: jest.fn(async (sql, params) => {
    executed.push({ sql, params });
    // Per-branch numbering mode.
    if (sql.includes('FROM pos_setting')) {
      return [state.setting ? [{ SettingValue: state.setting }] : []];
    }
    // The day's counter row.
    if (sql.includes('FROM pos_token_counter')) {
      const key = `${params[1]}|${params[2]}`;
      return [key in state.counters ? [{ LastNumber: state.counters[key] }] : []];
    }
    // The POS_TOKEN numbering series, and the config row it locks.
    if (sql.includes('TagName')) return [state.series ? [{ Id: 'cfg-token' }] : []];
    if (sql.includes('FROM transactiontypeconfig')) {
      return [[{ Id: 'cfg-token', StartCounterNo: '1', CurrentCounterNo: state.seriesCounter ?? 0, Prefix: 'TOK', Format: 'TOK-{0000}' }]];
    }
    if (sql.includes('SELECT * FROM pos_token')) return [state.token ? [state.token] : []];
    return [{ affectedRows: 1 }];
  }),
  query: jest.fn(async () => [[]]),
};

jest.mock('../../utils/dbHelper', () => ({
  withTransaction: (fn) => fn(mockConn),
  withConnection: (fn) => fn(mockConn),
}));

const service = require('../../modules/postoken/postoken.service');

// The LOCAL calendar date the service now stamps. These expectations used the
// UTC slice, which is the bug: east of UTC the two disagree for part of every
// day, so a token issued at 01:00 IST was filed under yesterday.
const { businessDate } = require('../../utils/dateRange');
const today = () => businessDate();

const TENANT = 'tn';
const BRANCH_A = 'branch-a';
const BRANCH_B = 'branch-b';
const USER = 'till@x.com';

beforeEach(() => {
  executed.length = 0;
  state = { setting: null, counters: {}, series: false, token: null };
  mockConn.execute.mockClear();
});

const issue = (branchId = BRANCH_A, orderId = null) =>
  service.create({ BranchDetailId: branchId, OrderId: orderId }, TENANT, USER);

const insertedToken = () => {
  const call = executed.find((e) => /INSERT INTO pos_token \(/.test(e.sql));
  // Params: id, tenant, TokenNumber, TokenLabel, TokenDate, OrderId, Status, ...
  return { number: call.params[2], label: call.params[3], date: call.params[4] };
};

describe('daily numbering — the default', () => {
  it('starts at 1 when the branch has no counter row for today', async () => {
    const token = await issue();
    expect(token).toMatchObject({ TokenNumber: 1, TokenLabel: '1' });
    expect(insertedToken()).toMatchObject({ number: 1, label: '1' });
  });

  it('continues from the day\'s counter', async () => {
    state.counters[`${BRANCH_A}|${today()}`] = 11;
    const token = await issue();
    expect(token.TokenNumber).toBe(12);
  });

  it('numbers each branch independently on the same day', async () => {
    state.counters[`${BRANCH_A}|${today()}`] = 40;
    // Branch B has never traded today, so it is still on 1 — a shared counter
    // would have handed it 41 and the two queues would call the same numbers.
    expect((await issue(BRANCH_A)).TokenNumber).toBe(41);
    expect((await issue(BRANCH_B)).TokenNumber).toBe(1);
  });

  it('restarts at 1 on a new day', async () => {
    // Yesterday's row is not the one read: the counter is keyed by date, which
    // is the whole reset mechanism.
    state.counters[`${BRANCH_A}|2020-01-01`] = 300;
    expect((await issue()).TokenNumber).toBe(1);
  });

  it('takes the counter row FOR UPDATE so two tills serialise', async () => {
    await issue();
    const lock = executed.find((e) => e.sql.includes('FROM pos_token_counter'));
    expect(lock.sql).toMatch(/FOR UPDATE/);
  });

  it('stamps today on the token', async () => {
    const token = await issue();
    expect(token.TokenDate).toBe(today());
  });
});

describe('series numbering — when the branch is configured for it', () => {
  beforeEach(() => { state.setting = 'series'; state.series = true; });

  it('renders the series label and keeps the counter behind it', async () => {
    state.seriesCounter = 7;
    const token = await issue();
    // The label is what gets called out; the number is what the queue sorts by.
    expect(token).toMatchObject({ TokenNumber: 8, TokenLabel: 'TOK-0008' });
  });

  it('does not touch the daily counter', async () => {
    await issue();
    expect(executed.some((e) => e.sql.includes('pos_token_counter'))).toBe(false);
  });

  it('falls back to daily numbering when the tenant has no such series', async () => {
    // A configuration gap must not leave a paid order unnumberable. The uuid
    // fallback used elsewhere (TOK-3F9A21B0) is no use to someone who has to
    // call the number across a counter.
    state.series = false;
    const token = await issue();
    expect(token).toMatchObject({ TokenNumber: 1, TokenLabel: '1' });
  });
});

describe('issuing rules', () => {
  it('refuses a token with no branch — it belongs to one queue', async () => {
    await expect(issue(null)).rejects.toThrow(/branch/i);
  });

  it('links the token to the order behind it', async () => {
    await issue(BRANCH_A, 'order-1');
    const call = executed.find((e) => /INSERT INTO pos_token \(/.test(e.sql));
    expect(call.params[5]).toBe('order-1');
  });

  it('is born waiting', async () => {
    await issue();
    const call = executed.find((e) => /INSERT INTO pos_token \(/.test(e.sql));
    expect(call.params[6]).toBe('waiting');
  });

  it('ignores a TokenNumber sent by the client', async () => {
    const token = await service.create(
      { BranchDetailId: BRANCH_A, TokenNumber: 999 }, TENANT, USER,
    );
    expect(token.TokenNumber).toBe(1);
  });
});

describe('advancing the queue', () => {
  beforeEach(() => {
    state.token = { Id: 'tok-1', TenantId: TENANT, TokenNumber: 3, Status: 'waiting' };
  });

  it('calls a token', async () => {
    await service.call('tok-1', TENANT, USER);
    const set = executed.find((e) => /UPDATE pos_token/.test(e.sql) && /CalledAt/.test(e.sql));
    expect(set.params[0]).toBe('called');
  });

  it('serves a token', async () => {
    await service.serve('tok-1', TENANT, USER);
    const set = executed.find((e) => /UPDATE pos_token/.test(e.sql) && /ServedAt/.test(e.sql));
    expect(set.params[0]).toBe('served');
  });

  it('stamps each timestamp only once, so a recall keeps the original call time', async () => {
    await service.call('tok-1', TENANT, USER);
    const set = executed.find((e) => /UPDATE pos_token/.test(e.sql) && /CalledAt/.test(e.sql));
    expect(set.sql).toMatch(/CalledAt IS NULL/);
    expect(set.sql).toMatch(/ServedAt IS NULL/);
  });

  it('reads the token back after the move, not before it', async () => {
    // The row is re-selected once the status has been written, or the caller
    // gets the token as it looked before it was called.
    await service.call('tok-1', TENANT, USER);
    const order = executed.map((e) => e.sql);
    const write = order.findIndex((s) => /UPDATE pos_token/.test(s));
    const lastRead = order.length - 1 - [...order].reverse()
      .findIndex((s) => /SELECT \* FROM pos_token/.test(s));
    expect(lastRead).toBeGreaterThan(write);
  });
});

describe('the queue read', () => {
  it('filters to one branch on one day, in SQL', async () => {
    await service.getAll(TENANT, 1, 50, { branchId: BRANCH_A, date: '2026-08-16' });
    const select = executed.find((e) => /FROM pos_token t/.test(e.sql) && !/COUNT/.test(e.sql));
    expect(select.sql).toMatch(/t\.BranchDetailId = \?/);
    expect(select.sql).toMatch(/t\.TokenDate = \?/);
    expect(select.params).toEqual([TENANT, BRANCH_A, '2026-08-16']);
  });

  it('joins the order so the queue can say what #7 gets', async () => {
    await service.getAll(TENANT, 1, 50, { branchId: BRANCH_A });
    const select = executed.find((e) => /FROM pos_token t/.test(e.sql) && !/COUNT/.test(e.sql));
    expect(select.sql).toMatch(/LEFT JOIN pos_order/);
  });
});
