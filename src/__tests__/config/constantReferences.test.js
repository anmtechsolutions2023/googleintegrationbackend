// src/__tests__/config/constantReferences.test.js
// Every QUERIES.X.Y and SCOPES.X named in the source must exist.
//
// A query retired from constants.js but still named somewhere fails only when
// that code path runs: conn.execute(undefined) breaks the connection, and the
// error reads "Can't add new command when connection is in closed state" — on
// whichever request happens to reach it first. That is how the tenant-switch
// endpoint went down in production after PERMISSIONS.SELECT was retired. This
// reads every source file and fails the build instead.

const fs = require('fs');
const path = require('path');
const { QUERIES, SCOPES } = require('../../config/constants');

const SRC = path.join(__dirname, '..', '..');

const sourceFiles = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const full = path.join(dir, e.name);
  if (e.isDirectory()) return e.name === '__tests__' ? [] : sourceFiles(full);
  return e.name.endsWith('.js') ? [full] : [];
});

const references = (pattern) => sourceFiles(SRC).flatMap((file) => {
  const text = fs.readFileSync(file, 'utf8')
    // Comments may mention retired names; only code counts.
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
  return [...text.matchAll(pattern)].map((m) => ({ file: path.relative(SRC, file), ref: m[0], parts: m.slice(1) }));
});

describe('constants referenced in the source', () => {
  it('every QUERIES.<GROUP>.<NAME> exists', () => {
    const missing = references(/\bQUERIES\.([A-Z][A-Z0-9_]*)\.([A-Z][A-Z0-9_]*)\b/g)
      .filter(({ parts: [group, name] }) => !QUERIES[group] || QUERIES[group][name] === undefined)
      .map(({ file, ref }) => `${file}: ${ref}`);
    expect(missing).toEqual([]);
  });

  it('every SCOPES.<NAME> exists', () => {
    const missing = references(/\bSCOPES\.([A-Z][A-Z0-9_]*)\b/g)
      .filter(({ parts: [name] }) => SCOPES[name] === undefined)
      .map(({ file, ref }) => `${file}: ${ref}`);
    expect(missing).toEqual([]);
  });
});
