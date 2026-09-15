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

// The rule is now ONE pure function, which is what lets it be tested without a
// database at all — and what stops a second copy of it drifting. A second copy
// briefly existed in SQL, and it disagreed with this one immediately: MySQL
// evaluates on the DATABASE server's clock (UTC on the container and on Aiven)
// while this compares against the APP server's, five and a half hours apart in
// development. A window read one way was closed and read the other way was open.
describe('availabilityOf — the default must be AVAILABLE', () => {
  const { availabilityOf } = service;
  // A Wednesday. getDay() is 3.
  const WED_1430 = new Date(2026, 8, 9, 14, 30, 0);
  const rule = (DayOfWeek, StartTime, EndTime) => ({ DayOfWeek, StartTime, EndTime });

  it('a category with NO rules is always on the menu', () => {
    expect(availabilityOf([], WED_1430)).toEqual({ available: true, opensAt: null });
  });

  it('treats a missing rule list as no rules, not as closed', () => {
    expect(availabilityOf(undefined, WED_1430).available).toBe(true);
    expect(availabilityOf(null, WED_1430).available).toBe(true);
  });

  it('is on while a window covers the moment', () => {
    expect(availabilityOf([rule(3, '09:00', '17:00')], WED_1430).available).toBe(true);
  });

  it('is off when every window is on another day', () => {
    // The same clock time, the wrong weekday. This is the case a naive
    // time-only comparison gets wrong.
    expect(availabilityOf([rule(4, '09:00', '17:00')], WED_1430).available).toBe(false);
  });

  it('is off between two windows on the same day', () => {
    const r = availabilityOf([rule(3, '07:00', '11:00'), rule(3, '18:00', '23:00')], WED_1430);
    expect(r.available).toBe(false);
    expect(r.opensAt).toBe('18:00:00');
  });

  it('names the NEXT window still to come today', () => {
    const r = availabilityOf([rule(3, '20:00', '23:00'), rule(3, '18:00', '19:00')], WED_1430);
    expect(r.opensAt).toBe('18:00:00');
  });

  it('falls back to the earliest start when nothing is left today', () => {
    const r = availabilityOf([rule(3, '07:00', '11:00'), rule(5, '09:00', '12:00')], WED_1430);
    expect(r.available).toBe(false);
    expect(r.opensAt).toBe('07:00:00');
  });

  // Start inclusive, end exclusive — the same boundary the stored rules assume,
  // so a window ending at 11:00 and one starting at 11:00 do not both match.
  it('includes the opening minute and excludes the closing one', () => {
    const at = (h, m) => new Date(2026, 8, 9, h, m, 0);
    const rules = [rule(3, '09:00', '11:00')];
    expect(availabilityOf(rules, at(9, 0)).available).toBe(true);
    expect(availabilityOf(rules, at(10, 59)).available).toBe(true);
    expect(availabilityOf(rules, at(11, 0)).available).toBe(false);
  });

  it('compares HH:MM and HH:MM:SS alike', () => {
    expect(availabilityOf([rule(3, '09:00', '17:00')], WED_1430).available).toBe(true);
    expect(availabilityOf([rule(3, '09:00:00', '17:00:00')], WED_1430).available).toBe(true);
  });
});

// A schedule is written in the OUTLET'S local time and evaluated on a server
// that is UTC in production. Without a zone, "breakfast 07:00" opens at 12:30
// IST. These are the cases that break when the zone is dropped or half-applied.
describe('clockIn — the trading day runs on the outlet\'s clock', () => {
  const { clockIn } = service;
  // Friday 19:00 UTC is already Saturday 00:30 in Kolkata.
  const FRI_1900Z = new Date('2026-09-11T19:00:00Z');

  it('reads the server\'s own clock when no zone is given', () => {
    const when = new Date(2026, 8, 9, 14, 30, 0);
    expect(clockIn(when, null)).toEqual({ day: 3, time: '14:30:00' });
  });

  it('converts the time into the zone', () => {
    expect(clockIn(FRI_1900Z, 'UTC').time).toBe('19:00:00');
    expect(clockIn(FRI_1900Z, 'Asia/Kolkata').time).toBe('00:30:00');
  });

  // The one that bites: taking the DAY from the server and the TIME from the
  // zone turns a Friday-night window into a Saturday one, silently.
  it('moves the weekday WITH the time across midnight', () => {
    expect(clockIn(FRI_1900Z, 'UTC').day).toBe(5);          // Friday
    expect(clockIn(FRI_1900Z, 'Asia/Kolkata').day).toBe(6); // Saturday
  });

  // hour12:false renders midnight as 24 in some locales, which sorts after
  // every stored StartTime and would match nothing.
  it('renders midnight as 00, never 24', () => {
    expect(clockIn(new Date('2026-09-11T18:30:00Z'), 'Asia/Kolkata').time).toBe('00:00:00');
  });

  it('decides availability, not the server it runs on', () => {
    // 19:00–20:00 on Friday. The same instant is inside that window in UTC and
    // outside it in Kolkata, where it is already Saturday.
    const rules = [{ DayOfWeek: 5, StartTime: '19:00', EndTime: '20:00' }];
    expect(service.availabilityOf(rules, FRI_1900Z, 'UTC').available).toBe(true);
    expect(service.availabilityOf(rules, FRI_1900Z, 'Asia/Kolkata').available).toBe(false);
  });
});

describe('indexByCategory — one read for a whole menu', () => {
  it('groups the tenancy\'s rules by the category they govern', () => {
    const map = service.indexByCategory([
      { CategoryId: 'c1', DayOfWeek: 1 },
      { CategoryId: 'c2', DayOfWeek: 2 },
      { CategoryId: 'c1', DayOfWeek: 3 },
    ]);
    expect(map.get('c1')).toHaveLength(2);
    expect(map.get('c2')).toHaveLength(1);
    // A category with no rules is ABSENT, and absent must read as available.
    expect(map.get('c3')).toBeUndefined();
    expect(service.availabilityOf(map.get('c3')).available).toBe(true);
  });

  it('survives an empty tenancy', () => {
    expect(service.indexByCategory([]).size).toBe(0);
    expect(service.indexByCategory(undefined).size).toBe(0);
  });
});

describe('isAvailableAt — reads this category\'s rules and applies the rule', () => {
  it('asks only for the category it was given', async () => {
    executeQuery.mockResolvedValue([]);
    await service.isAvailableAt(CATEGORY, TENANT);
    const [sql, params] = executeQuery.mock.calls[0];
    expect(sql).toBe(QUERIES.POS_CATEGORY_SCHEDULE.SELECT_BY_CATEGORY);
    expect(params).toEqual([CATEGORY, TENANT]);
  });

  it('is true when the category has no rules', async () => {
    executeQuery.mockResolvedValue([]);
    await expect(service.isAvailableAt(CATEGORY, TENANT)).resolves.toBe(true);
  });

  it('applies the moment it was given, not the moment it runs', async () => {
    executeQuery.mockResolvedValue([{ DayOfWeek: 3, StartTime: '09:00:00', EndTime: '17:00:00', Active: 1 }]);
    await expect(service.isAvailableAt(CATEGORY, TENANT, new Date(2026, 8, 9, 14, 30)))
      .resolves.toBe(true);
    await expect(service.isAvailableAt(CATEGORY, TENANT, new Date(2026, 8, 9, 18, 30)))
      .resolves.toBe(false);
  });

  it('ignores a rule that has been deactivated', async () => {
    executeQuery.mockResolvedValue([{ DayOfWeek: 3, StartTime: '09:00:00', EndTime: '17:00:00', Active: 0 }]);
    await expect(service.isAvailableAt(CATEGORY, TENANT, new Date(2026, 8, 9, 14, 30)))
      .resolves.toBe(true); // no ACTIVE rules at all, so the default applies
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
