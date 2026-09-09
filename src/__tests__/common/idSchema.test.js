// src/__tests__/common/idSchema.test.js
// The id validator, and the bug it exists to prevent.
//
// Ids in this database come in two shapes and BOTH live in `Id VARCHAR(50)`:
// generated UUIDs, and the mnemonic ids 02-seed-data.sql uses so a human can
// tell what a row is. `Joi.string().uuid()` accepts only the first, so every
// seeded row became readable but uneditable — a list loaded, and clicking any
// row answered `400 "id" must be a valid GUID`. Referencing one was worse: a
// menu item could not be saved against the seeded Veg food type at all.
//
// These tests read the ACTUAL ids out of the seed file rather than restating
// them, so a newly seeded master with a new mnemonic prefix is covered the day
// it is added instead of the day someone notices.

const fs = require('fs');
const path = require('path');
const Joi = require('joi');
const { entityId } = require('../../utils/idSchema');

const SEED = fs.readFileSync(
  path.join(__dirname, '../../../database/02-seed-data.sql'),
  'utf8',
);

// Every quoted id-shaped literal in the seed.
const seededIds = [...new Set(
  (SEED.match(/'[0-9a-zA-Z]{8}-[0-9a-zA-Z]{4}-[0-9a-zA-Z]{4}-[0-9a-zA-Z]{4}-[0-9a-zA-Z]{12}'/g) || [])
    .map((s) => s.slice(1, -1)),
)];

describe('the seed actually contains ids to check', () => {
  it('found a meaningful number of them', () => {
    expect(seededIds.length).toBeGreaterThan(50);
  });
});

describe('every id in the seed file passes validation', () => {
  it('accepts all of them', () => {
    const rejected = seededIds.filter((id) => entityId.validate(id).error);
    expect(rejected).toEqual([]);
  });

  // The regression itself, stated plainly: these are the exact ids that a
  // strict UUID rule threw out, and the reason six screens looked broken.
  it.each([
    ['food type', 'f0000001-ftyp-0000-0000-000000000001'],
    ['meat type', 'h0000001-mtyp-0000-0000-000000000001'],
    ['menu tag', 'j0000001-mtag-0000-0000-000000000001'],
    ['rejection reason', 'k0000001-rjsn-0000-0000-000000000001'],
    ['portal', 'p0000001-prtl-0000-0000-000000000001'],
    ['channel', 'c0000001-chan-0000-0000-000000000001'],
    ['ledger account', 'b0000001-ldgr-0000-0000-000000000001'],
    ['tax group', 'g0000001-txgp-0000-0000-000000000001'],
  ])('accepts a seeded %s id', (_label, id) => {
    expect(entityId.validate(id).error).toBeUndefined();
    // And the rule it replaced would have rejected it — which is the whole point.
    expect(Joi.string().uuid().validate(id).error).toBeDefined();
  });

  it('still accepts a generated uuid', () => {
    expect(entityId.validate('7c9e6679-7425-40de-944b-e07fc1f90ae7').error).toBeUndefined();
  });
});

describe('it is still a validator, not a pass-through', () => {
  it.each([
    ['free text', 'not-an-id'],
    ['empty', ''],
    ['sql fragment', "' OR 1=1--"],
    ['path traversal', '../../etc/passwd'],
    ['a name', 'Butter Chicken'],
    ['wrong segment lengths', 'abc-def-ghi-jkl-mno'],
    ['longer than the column', 'a'.repeat(60)],
  ])('rejects %s', (_label, value) => {
    expect(entityId.validate(value).error).toBeDefined();
  });
});

describe('no schema has drifted back to the strict rule', () => {
  // A single reintroduced `Joi.string().uuid()` silently breaks whichever
  // screen it guards, and only for seeded rows — the hardest kind of bug to
  // notice, because the developer's own freshly-created rows keep working.
  const walk = (dir, out = []) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name !== '__tests__' && e.name !== 'node_modules') walk(full, out);
      } else if (e.name.endsWith('.js')) {
        out.push(full);
      }
    }
    return out;
  };

  it('src/ contains no Joi.string().uuid()', () => {
    const srcRoot = path.join(__dirname, '../..');
    const offenders = walk(srcRoot)
      .filter((f) => fs.readFileSync(f, 'utf8').includes('Joi.string().uuid()'))
      .map((f) => path.relative(srcRoot, f));
    expect(offenders).toEqual([]);
  });
});
