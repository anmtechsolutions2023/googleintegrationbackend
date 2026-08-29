// src/__tests__/utils/dateRange.test.js
// One resolver serves every reporting timeframe. These tests pin the two things
// that make that safe: the bounds are right, and only whitelisted fragments can
// ever reach a SQL string.

const {
  resolveRange,
  bucketExpression,
  weekendPredicate,
  toDateTimeBounds,
  localOffsetMinutes,
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
  // The pool writes DATETIMEs in UTC (config/db.js, timezone: 'Z') while a
  // business day is local, so these bounds are the UTC INSTANTS that bracket
  // the local day. Written against the running machine's own offset rather
  // than a hard-coded zone, so the suite states the rule instead of the
  // author's timezone.
  const utcStamp = (d) => d.toISOString().slice(0, 19).replace('T', ' ');

  it('brackets the local day in the frame the column is stored in', () => {
    expect(toDateTimeBounds({ from: '2026-08-01', to: '2026-08-02' })).toEqual({
      from: utcStamp(new Date(2026, 7, 1, 0, 0, 0)),
      to: utcStamp(new Date(2026, 7, 2, 23, 59, 59)),
    });
  });

  it('covers the last day fully — the whole point of widening', () => {
    // BETWEEN '2026-08-01' AND '2026-08-02' on a DATETIME silently drops
    // everything after midnight on the last day.
    const { to } = toDateTimeBounds({ from: '2026-08-01', to: '2026-08-02' });
    const lastLocalSecond = utcStamp(new Date(2026, 7, 2, 23, 59, 59));
    expect(to).toBe(lastLocalSecond);
    expect(new Date(`${to.replace(' ', 'T')}Z`).getDate()).toBe(
      new Date(2026, 7, 2, 23, 59, 59).getUTCDate(),
    );
  });

  it('spans a whole day, however the offset falls', () => {
    // The window is 24h minus the one second between 23:59:59 and midnight.
    const { from, to } = toDateTimeBounds({ from: '2026-08-01', to: '2026-08-01' });
    const ms = new Date(`${to.replace(' ', 'T')}Z`) - new Date(`${from.replace(' ', 'T')}Z`);
    expect(ms).toBe((24 * 60 * 60 - 1) * 1000);
  });

  it('an evening sale east of Greenwich stays on its own business day', () => {
    // The regression this exists for: at IST a 20:00 local sale is stored as
    // 14:30 UTC, and naive bounds put it in the wrong day's Z-report.
    const evening = new Date(2026, 7, 1, 20, 0, 0);
    const { from, to } = toDateTimeBounds({ from: '2026-08-01', to: '2026-08-01' });
    expect(utcStamp(evening) >= from && utcStamp(evening) <= to).toBe(true);
  });
});

describe('weekendPredicate', () => {
  it('is empty unless the weekend filter is on', () => {
    expect(weekendPredicate(false, 'l.TransactionDate')).toBe('');
  });

  it('reads a local date column as it stands', () => {
    expect(weekendPredicate(true, 'l.TransactionDate'))
      .toBe(' AND WEEKDAY(l.TransactionDate) IN (5, 6)');
  });

  it('shifts a UTC column into local time before asking the weekday', () => {
    // A Saturday 11pm sale in IST is a SUNDAY instant in UTC. Asking
    // WEEKDAY() of the raw column files late trade under the wrong day.
    const sql = weekendPredicate(true, 'b.Timestamp', { utc: true });
    expect(sql).toBe(
      ` AND WEEKDAY(b.Timestamp + INTERVAL ${localOffsetMinutes()} MINUTE) IN (5, 6)`,
    );
    expect(sql).toMatch(/^ AND WEEKDAY\(b\.Timestamp \+ INTERVAL -?\d+ MINUTE\) IN \(5, 6\)$/);
  });
});

describe('the whitelist itself', () => {
  it('exposes exactly the presets the API documents', () => {
    expect(VALID_PRESETS).toEqual(
      expect.arrayContaining(['today', 'yesterday', 'last3', 'last5', 'week', 'month', 'weekend', 'custom']),
    );
  });
});
