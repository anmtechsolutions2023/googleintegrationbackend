// src/__tests__/modules/poscategoryschedule.service.test.js
// Category availability windows.
//
// Two rules carry the whole feature, and both fail SILENTLY when wrong:
//
//   1. NO RULES MEANS ALWAYS AVAILABLE. If that default inverts, introducing
//      this table removes every existing category from every menu, and the data
//      looks perfectly correct while it happens.
//
//   2. An overnight window (Fri 22:00–02:00) stored as one row can never match:
//      every lookup is `StartTime <= now AND EndTime > now`, and with EndTime
//      before StartTime that is unsatisfiable. It must be split at midnight.

jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  captureAudit: jest.fn(),
}));
jest.mock('uuid', () => ({ v4: jest.fn(() => 'mock-uuid') }));

jest.mock('../../utils/dbHelper', () => ({
  withConnection: jest.fn(),
  withTransaction: jest.fn(),
  findOneOrFail: jest.fn(),
  findAll: jest.fn(),
  executeQuery: jest.fn(),
}));

const { executeQuery, withTransaction } = require('../../utils/dbHelper');
const { QUERIES } = require('../../config/constants');
const service = require('../../modules/poscategoryschedule/poscategoryschedule.service');
const { splitOvernight, normaliseTime } = service;

const TENANT = 'tenant-1';
const CATEGORY = 'cat-1';
const USER = '+919999999999';

beforeEach(() => jest.clearAllMocks());

describe('normalising a time', () => {
  it('pads HH:MM to HH:MM:SS so comparisons use one format', () => {
    expect(normaliseTime('09:30')).toBe('09:30:00');
  });
  it('leaves HH:MM:SS alone', () => {
    expect(normaliseTime('09:30:15')).toBe('09:30:15');
  });
});

describe('splitting a window at midnight', () => {
  it('leaves an ordinary window as one row', () => {
    expect(splitOvernight({ DayOfWeek: 1, StartTime: '09:00', EndTime: '17:00' }))
      .toEqual([{ DayOfWeek: 1, StartTime: '09:00:00', EndTime: '17:00:00' }]);
  });

  it('splits Friday 22:00–02:00 into Friday night and Saturday morning', () => {
    expect(splitOvernight({ DayOfWeek: 5, StartTime: '22:00', EndTime: '02:00' }))
      .toEqual([
        { DayOfWeek: 5, StartTime: '22:00:00', EndTime: '24:00:00' },
        { DayOfWeek: 6, StartTime: '00:00:00', EndTime: '02:00:00' },
      ]);
  });

  // Saturday(6) → Sunday(0), not day 7, which no row could ever match.
  it('wraps Saturday round to Sunday, not to a day 7', () => {
    const [, second] = splitOvernight({ DayOfWeek: 6, StartTime: '23:00', EndTime: '01:00' });
    expect(second.DayOfWeek).toBe(0);
  });

  // Equal start and end is a typo, not "all day". Storing it would create a
  // rule that never fires, on a category that then looks scheduled but is not.
  it('refuses a zero-length window rather than storing one that never fires', () => {
    expect(() => splitOvernight({ DayOfWeek: 1, StartTime: '09:00', EndTime: '09:00' }))
      .toThrow(/cannot start and end at the same time/i);
  });
});

describe('availability — the default must be AVAILABLE', () => {
  const answer = (RuleCount, MatchCount) =>
    executeQuery.mockResolvedValue([{ RuleCount, MatchCount }]);

  it('a category with NO rules is always on the menu', async () => {
    answer(0, 0);
    await expect(service.isAvailableAt(CATEGORY, TENANT)).resolves.toBe(true);
  });

  it('a category with rules is on only while one matches', async () => {
    answer(3, 1);
    await expect(service.isAvailableAt(CATEGORY, TENANT)).resolves.toBe(true);
  });

  it('a category with rules and no current match is off', async () => {
    answer(3, 0);
    await expect(service.isAvailableAt(CATEGORY, TENANT)).resolves.toBe(false);
  });

  it('asks with the weekday and time of the moment given', async () => {
    answer(0, 0);
    // A Wednesday at 14:30 local. getDay() is 3.
    const when = new Date(2026, 8, 9, 14, 30, 0);
    await service.isAvailableAt(CATEGORY, TENANT, when);
    const [, params] = executeQuery.mock.calls[0];
    expect(params).toEqual([
      CATEGORY, TENANT,
      CATEGORY, TENANT, when.getDay(), '14:30:00', '14:30:00',
    ]);
  });
});

describe('replacing a week', () => {
  const conn = { execute: jest.fn() };

  const runTransaction = ({ categoryExists = true, stored = [] } = {}) => {
    conn.execute.mockReset();
    conn.execute.mockImplementation(async (sql) => {
      if (sql === QUERIES.CATEGORY.SELECT_BY_ID) return [categoryExists ? [{ Id: CATEGORY }] : []];
      if (sql === QUERIES.POS_CATEGORY_SCHEDULE.SELECT_BY_CATEGORY) return [stored];
      return [{ affectedRows: 1 }];
    });
    withTransaction.mockImplementation(async (cb) => cb(conn));
  };

  it('refuses a category that is not in this tenancy', async () => {
    runTransaction({ categoryExists: false });
    await expect(service.replaceForCategory(CATEGORY, [], TENANT, USER))
      .rejects.toMatchObject({ statusCode: 404 });
  });

  it('clears the old rules before writing the new ones', async () => {
    runTransaction();
    await service.replaceForCategory(
      CATEGORY, [{ DayOfWeek: 1, StartTime: '09:00', EndTime: '17:00' }], TENANT, USER,
    );
    const sqls = conn.execute.mock.calls.map(([s]) => s);
    const del = sqls.indexOf(QUERIES.POS_CATEGORY_SCHEDULE.DELETE_BY_CATEGORY);
    const ins = sqls.indexOf(QUERIES.POS_CATEGORY_SCHEDULE.INSERT);
    expect(del).toBeGreaterThan(-1);
    expect(ins).toBeGreaterThan(del);
  });

  // The empty array is the ONLY route back to always-available.
  it('accepts an empty week and writes no rules', async () => {
    runTransaction();
    await service.replaceForCategory(CATEGORY, [], TENANT, USER);
    const sqls = conn.execute.mock.calls.map(([s]) => s);
    expect(sqls).toContain(QUERIES.POS_CATEGORY_SCHEDULE.DELETE_BY_CATEGORY);
    expect(sqls).not.toContain(QUERIES.POS_CATEGORY_SCHEDULE.INSERT);
  });

  it('stores TWO rows for one overnight rule', async () => {
    runTransaction();
    await service.replaceForCategory(
      CATEGORY, [{ DayOfWeek: 5, StartTime: '22:00', EndTime: '02:00' }], TENANT, USER,
    );
    const inserts = conn.execute.mock.calls
      .filter(([s]) => s === QUERIES.POS_CATEGORY_SCHEDULE.INSERT);
    expect(inserts).toHaveLength(2);
  });

  it('scopes every write to the tenant', async () => {
    runTransaction();
    await service.replaceForCategory(
      CATEGORY, [{ DayOfWeek: 2, StartTime: '08:00', EndTime: '11:00' }], TENANT, USER,
    );
    conn.execute.mock.calls.forEach(([, params]) => {
      if (Array.isArray(params)) expect(params).toContain(TENANT);
    });
  });
});

describe('the queries', () => {
  it('scope every read and write by tenant', () => {
    const q = QUERIES.POS_CATEGORY_SCHEDULE;
    expect(q.SELECT_BY_CATEGORY).toMatch(/TenantId = \?/);
    expect(q.DELETE_BY_CATEGORY).toMatch(/TenantId = \?/);
    expect(q.SELECT_ALL_FOR_TENANT).toMatch(/s\.TenantId = \?/);
  });

  it('join the category within the same tenant only', () => {
    expect(QUERIES.POS_CATEGORY_SCHEDULE.SELECT_ALL_FOR_TENANT)
      .toMatch(/c\.TenantId = s\.TenantId/);
  });

  // Counts VALUES ITEMS, not just placeholders: this INSERT writes Active as a
  // literal 1 and CreatedOn as NOW(), so a "?"-only tally under-counts and
  // reports a mismatch that is not there. Comparing the two comma-separated
  // lists is what actually catches a column/value skew.
  it('has an INSERT whose values line up with its columns', () => {
    const sql = QUERIES.POS_CATEGORY_SCHEDULE.INSERT;
    const cols = sql.match(/\(([^)]+)\)\s+VALUES/i)[1].split(',').length;
    const vals = sql.match(/VALUES\s*\((.+)\)\s*$/i)[1].split(',').length;
    expect(vals).toBe(cols);
  });

  // A half-open window: EndTime > now, not >=. Back-to-back rules (09:00–12:00,
  // 12:00–15:00) must not both match at exactly 12:00.
  it('treats a window as half-open so adjacent rules never overlap', () => {
    expect(QUERIES.POS_CATEGORY_SCHEDULE.COUNT_ACTIVE_NOW).toMatch(/EndTime > \?/);
    expect(QUERIES.POS_CATEGORY_SCHEDULE.COUNT_ACTIVE_NOW).toMatch(/StartTime <= \?/);
  });
});
