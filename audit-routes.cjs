// READ-ONLY endpoint protection audit.
// Resolves const-bound guards (const X = checkScope(...)) and const arrays
// (const READ = [authenticateToken, checkScope(...)]) before judging a route.
const fs = require('fs'), path = require('path');

const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const balanced = (s, start) => {
  let d = 0;
  for (let i = start; i < s.length; i++) {
    if (s[i] === '(' || s[i] === '[') d++;
    else if (s[i] === ')' || s[i] === ']') { d--; if (d === 0) return s.slice(start, i + 1); }
  }
  return s.slice(start);
};

// Every `const NAME = <expr>` in the file, with the expression text.
const consts = (src) => {
  const out = {};
  const re = /const\s+([A-Za-z_$][\w$]*)\s*=\s*/g;
  let m;
  while ((m = re.exec(src))) {
    const at = m.index + m[0].length;
    if (src[at] === '(' || src[at] === '[') out[m[1]] = balanced(src, at);
    else out[m[1]] = src.slice(at, src.indexOf(';', at));
  }
  return out;
};

// Expand identifiers until the chain text stops changing (handles a guard that
// is itself built from another const).
const expand = (chain, map) => {
  for (let i = 0; i < 6; i++) {
    let next = chain;
    for (const [name, body] of Object.entries(map)) {
      next = next.split(`...${name}`).join(body).replace(
        new RegExp(`(^|[^\\w$.])${name}(?![\\w$])`, 'g'), `$1${body}`);
    }
    if (next === chain) break;
    chain = next;
  }
  return chain;
};

const rows = [];
for (const mod of fs.readdirSync('src/modules')) {
  const dir = path.join('src/modules', mod);
  if (!fs.statSync(dir).isDirectory()) continue;
  for (const file of fs.readdirSync(dir).filter((x) => x.endsWith('.routes.js'))) {
    const full = path.join(dir, file);
    const src = strip(fs.readFileSync(full, 'utf8'));
    const map = consts(src);
    const re = /router\.(get|post|put|patch|delete)\s*\(/g;
    let m;
    while ((m = re.exec(src))) {
      const call = balanced(src, m.index + m[0].length - 1);
      const chain = expand(call, map);
      rows.push({
        mod,
        method: m[1].toUpperCase(),
        path: (call.match(/^\(\s*['"`]([^'"`]*)['"`]/) || [])[1] ?? '?',
        auth: /\bauthenticateToken\b/.test(chain),
        scope: /\bcheckScope\s*\(/.test(chain),
        file: full,
      });
    }
  }
}
fs.writeFileSync('/tmp/routes.json', JSON.stringify(rows, null, 0));

const w = (r) => r.method !== 'GET';
console.log(`TOTAL ROUTES: ${rows.length}`);
console.log(`  authenticated + scoped  : ${rows.filter((r) => r.auth && r.scope).length}`);
console.log(`  authenticated, NO scope : ${rows.filter((r) => r.auth && !r.scope).length}`);
console.log(`  NO authentication       : ${rows.filter((r) => !r.auth).length}`);

console.log('\n===== A · NO AUTHENTICATION =====');
rows.filter((r) => !r.auth).forEach((r) => console.log(`  ${r.method.padEnd(6)} ${r.path.padEnd(18)} ${r.file}`));

const gaps = rows.filter((r) => r.auth && !r.scope);
console.log(`\n===== B · AUTHENTICATED, NO SCOPE (${gaps.length}) =====`);
console.log(`  writes: ${gaps.filter(w).length}   reads: ${gaps.filter((r) => !w(r)).length}\n`);
const by = {};
gaps.forEach((r) => { (by[r.mod] ||= []).push(`${w(r) ? '*' : ' '}${r.method} ${r.path}`); });
Object.entries(by).sort().forEach(([m, l]) => console.log(`  ${m.padEnd(17)} ${l.join(' | ')}`));
console.log('\n  (* = writes)');
