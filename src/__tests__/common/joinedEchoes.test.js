// A joined column must never refuse a save.
//
// Every module whose SELECT adds `AS Alias` hands that alias to the client on
// read. An edit form seeded from a GET sends the whole row back on the next
// PUT — so the write schema sees the alias, and a strict schema that has never
// heard of it rejects the ENTIRE update with "not allowed". The form loads
// perfectly and refuses to save, and the message names one field while the
// others queue up behind Joi's abortEarly.
//
// This was found the hard way: PUT /api/pos/item-meta failed on CategoryId,
// and the same drift turned out to exist in eleven more modules. It happened
// because the tolerance lived in a hand-maintained list that had to be updated
// every time somebody added a join. joinedEchoes derives it from the query
// instead; this test is what keeps that true.

const fs = require('fs');
const path = require('path');
const { QUERIES } = require('../../config/constants');

const MODULES = path.resolve(__dirname, '../../modules');

/** `AS Alias` names a module's reads add on top of its real columns. */
const aliasesOf = (queries) => {
  const sql = [
    queries?.SELECT_ALL,
    queries?.SELECT_BY_ID,
    queries?.SELECT_BY_ID_WITH_DETAILS,
  ]
    .filter((s) => typeof s === 'string')
    .join('\n');

  return [...new Set(
    [...sql.matchAll(/\bAS\s+([A-Za-z_][\w]*)/gi)].map((m) => m[1]),
  )].filter((a) => a !== 'total');
};

/** Every module's write schemas, paired with the aliases its reads produce. */
const writeSchemas = () => {
  const found = [];

  for (const dir of fs.readdirSync(MODULES)) {
    const modPath = path.join(MODULES, dir);
    if (!fs.statSync(modPath).isDirectory()) continue;

    const key = Object.keys(QUERIES).find(
      (k) => k.toLowerCase().replace(/_/g, '') === dir,
    );
    if (!key) continue;

    const aliases = aliasesOf(QUERIES[key]);
    if (aliases.length === 0) continue;

    for (const file of fs.readdirSync(modPath)) {
      if (!file.endsWith('schemas.js')) continue;

      // eslint-disable-next-line global-require
      const mod = require(path.join(modPath, file));
      for (const [name, schema] of Object.entries(mod)) {
        if (!/^(create|update)/.test(name)) continue;
        if (!schema || typeof schema.validate !== 'function') continue;
        found.push({ module: dir, name, schema, aliases });
      }
    }
  }

  return found;
};

describe('a joined column never refuses a save', () => {
  const cases = writeSchemas();

  it('finds write schemas to check', () => {
    // Guards the guard: a discovery bug would make every assertion below vacuous.
    expect(cases.length).toBeGreaterThan(10);
  });

  it.each(cases.map((c) => [`${c.module} ${c.name}`, c]))(
    '%s tolerates the aliases its own reads produce',
    (_label, { schema, aliases }) => {
      // Only the aliases. Missing-required-field complaints are expected and
      // irrelevant — what must not appear is "is not allowed", which is the
      // one that rejects the whole payload.
      const body = Object.fromEntries(aliases.map((a) => [a, 'echoed']));
      const { error } = schema.validate(body, { abortEarly: false });

      const rejected = (error?.details ?? [])
        .filter((d) => d.type === 'object.unknown')
        .map((d) => d.path.join('.'));

      expect(rejected).toEqual([]);
    },
  );
});
