// MySQL only treats "X" as a string when ANSI_QUOTES is off. Managed providers
// (Aiven among them) run with it on, where "X" is an identifier instead — so a
// query that works on a stock local server fails in production with
// "Unknown column 'X' in 'field list'", which reads like a schema problem rather
// than a quoting one. It cost a production sign-in outage once. Single-quote
// every SQL literal; this test is the thing that remembers.

const fs = require('fs');
const path = require('path');

const SRC_ROOT = path.join(__dirname, '..', '..');

const collectSourceFiles = (dir, acc = []) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== '__tests__') collectSourceFiles(full, acc);
    } else if (entry.name.endsWith('.js')) {
      acc.push(full);
    }
  }
  return acc;
};

// A single-quoted JS string holding SQL that also contains a double quote. That
// is the broken shape exactly: the delimiter forced the literal into double
// quotes. The fixed shape — a double-quoted JS string wrapping 'LITERAL' — does
// not match, so this stays quiet once the SQL is correct.
const BROKEN_SQL_QUOTING =
  /'[^']*\b(?:SELECT|INSERT|UPDATE|DELETE|REPLACE)\b[^']*"[^']*'/i;

describe('SQL literals are single-quoted (ANSI_QUOTES safety)', () => {
  const files = collectSourceFiles(SRC_ROOT);

  test('finds source files to scan', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  test.each(files.map((f) => [path.relative(SRC_ROOT, f), f]))(
    '%s uses no double-quoted SQL literals',
    (_relative, file) => {
      const offenders = fs
        .readFileSync(file, 'utf8')
        .split('\n')
        .map((line, i) => [i + 1, line])
        .filter(([, line]) => BROKEN_SQL_QUOTING.test(line))
        .map(([lineNo, line]) => `  line ${lineNo}: ${line.trim()}`);

      expect(offenders.join('\n')).toBe('');
    }
  );
});
