// One request, ONE connection — enforced across the whole codebase.
//
// A helper that takes its own connection while its caller is holding one turns
// every such request into a two-connection request, and a pool where enough of
// those overlap deadlocks: all of them hold one and wait for another that
// nobody is left to release. mysql2 has NO acquire timeout, so that wait never
// ends — the process keeps serving /api-docs and hangs on everything touching
// the database.
//
// This has now bitten three times in three different modules (a settle, a KOT
// marked ready, a token advanced), each found only after a person reported the
// screen hanging. A runtime test cannot catch it, because the settle tests stub
// withConnection/withTransaction to hand back ONE shared connection and so
// cannot observe a second acquisition at all. This reads the source instead.
//
// `withConnection(cb, existingConn)` and `getById(id, tenantId, expand, conn)`
// both take the caller's connection for exactly this reason. Pass yours down.

const fs = require('fs');
const path = require('path');

const SRC = path.resolve(__dirname, '../..');

const jsFiles = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const p = path.join(dir, e.name);
  if (e.isDirectory()) return e.name === '__tests__' ? [] : jsFiles(p);
  return e.name.endsWith('.js') ? [p] : [];
});

/**
 * Every place inside a withConnection/withTransaction block that acquires a
 * connection of its own instead of borrowing the block's.
 * @returns {Array<{file: string, line: number, why: string, text: string}>}
 */
const nestedAcquisitions = () => {
  const found = [];

  for (const file of jsFiles(SRC)) {
    const lines = fs.readFileSync(file, 'utf8').split('\n');

    for (let i = 0; i < lines.length; i++) {
      if (!/with(Connection|Transaction)\(/.test(lines[i])) continue;

      // The name this block binds its connection to. Without one there is
      // nothing to check against.
      const bound = lines[i].match(/\(\s*(?:async\s*)?\(?\s*([A-Za-z_$][\w$]*)\s*\)?\s*=>/);
      if (!bound) continue;
      const connVar = bound[1];

      let depth = 0;
      let started = false;
      for (let j = i; j < lines.length; j++) {
        for (const ch of lines[j]) {
          if (ch === '{') { depth++; started = true; } else if (ch === '}') depth--;
        }

        if (j > i) {
          const text = lines[j].trim();
          const rel = path.relative(SRC, file);

          if (/with(Connection|Transaction)\(/.test(lines[j])) {
            found.push({ file: rel, line: j + 1, why: 'opens another pool connection', text });
          }

          const call = lines[j].match(
            /(?:this|super|service|[\w$]+Service)\.getById\(([^)]*)\)/,
          );
          if (call && !call[1].includes(connVar)) {
            found.push({
              file: rel,
              line: j + 1,
              why: `getById does not borrow "${connVar}"`,
              text,
            });
          }
        }

        if (started && depth <= 0) break;
      }
    }
  }

  // The same line can sit inside two nested blocks.
  const seen = new Set();
  return found.filter((x) => {
    const k = `${x.file}:${x.line}:${x.why}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
};

describe('one connection per request', () => {
  it('no code inside a connection block takes a second connection', () => {
    const hits = nestedAcquisitions();

    const report = hits
      .map((h) => `  ${h.file}:${h.line} — ${h.why}\n      ${h.text}`)
      .join('\n');

    expect(report).toBe('');
  });

  it('the check can actually see a nesting', () => {
    // Guards the guard: a scanner that silently matches nothing would pass this
    // suite for the wrong reason.
    const sample = [
      'const f = () => withConnection(async (conn) => {',
      '  await this.getById(id, tenantId);',
      '});',
    ];

    const bound = sample[0].match(/\(\s*(?:async\s*)?\(?\s*([A-Za-z_$][\w$]*)\s*\)?\s*=>/);
    expect(bound[1]).toBe('conn');
    expect(sample[1].match(/this\.getById\(([^)]*)\)/)[1]).not.toContain('conn');
  });
});
