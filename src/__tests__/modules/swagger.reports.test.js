// The OpenAPI spec, held against the routers it claims to describe.
//
// Nine finance report endpoints shipped and stayed undocumented for as long as
// nothing compared the two. A spec nobody checks is worse than no spec: it
// looks authoritative while quietly going stale. This holds the report surface
// — the part with a helper generating it — in sync in BOTH directions.

const spec = require('../../config/swagger');
const ledgerRoutes = require('../../modules/ledger/ledger.routes');
const tokenRoutes = require('../../modules/postoken/postoken.routes');

/** GET paths an Express router actually serves, as full API paths. */
const getPathsOf = (router, prefix) =>
  router.stack
    .filter((l) => l.route && l.route.methods.get)
    .map((l) => `${prefix}${l.route.path}`);

const documented = (re) => Object.keys(spec.paths).filter((p) => re.test(p));

describe('swagger — finance reports', () => {
  it('documents every report the ledger router serves', () => {
    const served = getPathsOf(ledgerRoutes, '/api/ledger')
      .filter((p) => p.includes('/reports/'))
      .sort();
    expect(served.length).toBeGreaterThan(0);
    expect(documented(/^\/api\/ledger\/reports\//).sort()).toEqual(served);
  });

  it('documents the token queue statistics endpoint', () => {
    expect(getPathsOf(tokenRoutes, '/api/pos/tokens')).toContain('/api/pos/tokens/stats');
    expect(spec.paths['/api/pos/tokens/stats']).toBeDefined();
  });

  it('gives every report the shared timeframe contract, not its own', () => {
    // The whole point of one query schema: daily, weekend-only and custom are
    // `preset` values rather than separate endpoints. A report documenting its
    // own timeframe parameters would be the first step back towards that.
    documented(/^\/api\/ledger\/reports\//).forEach((path) => {
      const names = spec.paths[path].get.parameters.map((p) => p.name);
      expect(names).toEqual(expect.arrayContaining(['preset', 'fromDate', 'toDate', 'branchId']));
    });
  });

  it('resolves every schema it references', () => {
    const schemas = spec.components.schemas;
    const missing = new Set();
    const walk = (node) => {
      if (!node || typeof node !== 'object') return;
      if (typeof node.$ref === 'string' && !schemas[node.$ref.split('/').pop()]) {
        missing.add(node.$ref);
      }
      Object.values(node).forEach(walk);
    };
    walk(spec.paths);
    walk(schemas);
    expect([...missing]).toEqual([]);
  });

  it('describes the channel report as reading the ledger, beside the queue stats that do not', () => {
    // The separation is the design: revenue is an accounting question and lives
    // in the ledger; how long somebody stood at a counter is not.
    expect(spec.components.schemas.ReportChannels.description).toMatch(/venue report/i);
    expect(spec.components.schemas.TokenQueueStats.description).toMatch(/pos_token/);
  });
});
