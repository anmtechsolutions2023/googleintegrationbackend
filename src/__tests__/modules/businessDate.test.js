// One definition of "which day is this?", shared by whatever WRITES a date and
// whatever READS a range back.
//
// Documents were stamped with toISOString().slice(0, 10) — the date in UTC —
// while every report resolves a range from the LOCAL calendar. In UTC+5:30 that
// filed each sale taken before 05:30 under the previous day: the till said
// today, Finance said yesterday, and neither was lying about its own clock.

const { businessDate, toISODate, resolveRange } = require('../../utils/dateRange');

describe('businessDate', () => {
  it('reads the LOCAL calendar, not UTC', () => {
    // 2026-08-20T20:30:00Z is already the 21st in UTC+5:30. Anywhere east of
    // UTC the two disagree for part of every day, and that gap is the bug.
    const late = new Date('2026-08-20T20:30:00Z');
    expect(businessDate(late)).toBe(toISODate(late));
  });

  it('agrees with what a report resolves as today', () => {
    // The invariant that matters: a sale stamped now must fall inside the
    // window "today" resolves to. Nothing else about the format is important.
    const range = resolveRange({ preset: 'today' });
    expect(businessDate()).toBe(range.from);
    expect(businessDate()).toBe(range.to);
  });

  it('accepts a supplied date for a back-dated document', () => {
    expect(businessDate('2026-07-04T09:00:00')).toBe('2026-07-04');
  });

  it('defaults to now when given nothing', () => {
    expect(businessDate()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('the ledger writes what the reports read', () => {
  it('stamps sales with businessDate, never with a UTC slice', () => {
    // Asserted against the source: the two call sites are what drifted, and a
    // unit test of the helper alone would not have caught it.
    const fs = require('fs');
    const src = fs.readFileSync(
      require.resolve('../../modules/ledger/ledger.service'), 'utf8',
    );
    expect(src).toMatch(/businessDate\(\)/);
    expect(src).toMatch(/businessDate\(expenseDate\)/);
    // Only the explanatory comment may mention the old form.
    const code = src.split('\n').filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//'));
    expect(code.join('\n')).not.toMatch(/toISOString\(\)\.slice\(0, 10\)/);
  });

  it('stamps counter tokens the same way, so the Channels tab agrees with itself', () => {
    const fs = require('fs');
    const src = fs.readFileSync(
      require.resolve('../../modules/postoken/postoken.service'), 'utf8',
    );
    expect(src).toMatch(/businessDate/);
    const code = src.split('\n').filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//'));
    expect(code.join('\n')).not.toMatch(/toISOString\(\)\.slice\(0, 10\)/);
  });
});
