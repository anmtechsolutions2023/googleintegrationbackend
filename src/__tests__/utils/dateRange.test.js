// src/__tests__/utils/dateRange.test.js
// One resolver serves every reporting timeframe. These tests pin the two things
// that make that safe: the bounds are right, and only whitelisted fragments can
// ever reach a SQL string.

const {
  resolveRange,
  bucketExpression,
  weekendPredicate,
  toDateTimeBounds,
  toISODate,
  VALID_PRESETS,
  VALID_BUCKETS,
} = require('../../utils/dateRange');

const daysBetween = (from, to) =>
  Math.round((new Date(to) - new Date(from)) / 86400000);

describe('resolveRange — presets', () => {
  it.each([
    ['today', 0],
    ['last3', 2],
    ['last5', 4],
    ['week', 6],
    ['month', 29],
  ])('%s spans %i days back from today', (preset, span) => {
    const r = resolveRange({ preset });
    expect(r.to).toBe(toISODate(new Date()));
    expect(daysBetween(r.from, r.to)).toBe(span);
  });

  it('yesterday is a single day, not a range ending today', () => {
    const r = resolveRange({ preset: 'yesterday' });
    expect(r.from).toBe(r.to);
    expect(daysBetween(r.from, toISODate(new Date()))).toBe(1);
  });

  it('weekend is the weekly window plus a filter, not a separate report', () => {
    const week = resolveRange({ preset: 'week' });
    const weekend = resolveRange({ preset: 'weekend' });
    expect(weekend.from).toBe(week.from);
    expect(weekend.to).toBe(week.to);
    expect(weekend.weekendOnly).toBe(true);
    expect(week.weekendOnly).toBe(false);
  });

  it('honours an explicit custom range', () => {
    const r = resolveRange({ preset: 'custom', fromDate: '2026-01-01', toDate: '2026-03-31' });
    expect(r.from).toBe('2026-01-01');
    expect(r.to).toBe('2026-03-31');
  });

  it('falls back to today rather than scanning all history', () => {
    // An unbounded default would make one careless request read every row the
    // tenant has ever written.
    const r = resolveRange({});
    expect(r.from).toBe(toISODate(new Date()));
    expect(r.to).toBe(toISODate(new Date()));
  });

  it('rejects an unknown preset by falling back to custom', () => {
    expect(resolveRange({ preset: 'last-decade' }).preset).toBe('custom');
  });

  it('uses local dates, not UTC — a late-evening report is not tomorrow', () => {
    const now = new Date();
    expect(toISODate(now)).toBe(
      `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`,
    );
  });
});

describe('bucketExpression — the GROUP BY', () => {
  it('buckets by day, ISO week and month', () => {
    expect(bucketExpression('day', 'l.D')).toBe('DATE(l.D)');
    expect(bucketExpression('week', 'l.D')).toBe('YEARWEEK(l.D, 3)');
    expect(bucketExpression('month', 'l.D')).toBe("DATE_FORMAT(l.D, '%Y-%m')");
  });

  it('falls back to day for anything not whitelisted', () => {
    // This is the injection guard: no caller-supplied string can become SQL.
    expect(bucketExpression("x'; DROP TABLE pos_bill; --", 'l.D')).toBe('DATE(l.D)');
  });

  it('only ever emits one of the known fragments', () => {
    const emitted = VALID_BUCKETS.map((b) => bucketExpression(b, 'c'));
    expect(new Set(emitted).size).toBe(VALID_BUCKETS.length);
  });
});

describe('weekendPredicate', () => {
  it('uses WEEKDAY 5,6 — Saturday and Sunday', () => {
    // WEEKDAY() is 0=Monday..6=Sunday. DAYOFWEEK() is 1-based Sunday-first;
    // mixing the two is the classic off-by-one here.
    expect(weekendPredicate(true, 'l.D')).toBe(' AND WEEKDAY(l.D) IN (5, 6)');
  });

  it('emits nothing when the range is not weekend-only', () => {
    expect(weekendPredicate(false, 'l.D')).toBe('');
  });
});

describe('toDateTimeBounds', () => {
  it('widens a date range to cover whole days', () => {
    // BETWEEN '2026-08-01' AND '2026-08-02' on a DATETIME silently drops
    // everything after midnight on the last day.
    expect(toDateTimeBounds({ from: '2026-08-01', to: '2026-08-02' })).toEqual({
      from: '2026-08-01 00:00:00',
      to: '2026-08-02 23:59:59',
    });
  });
});

describe('the whitelist itself', () => {
  it('exposes exactly the presets the API documents', () => {
    expect(VALID_PRESETS).toEqual(
      expect.arrayContaining(['today', 'yesterday', 'last3', 'last5', 'week', 'month', 'weekend', 'custom']),
    );
  });
});
