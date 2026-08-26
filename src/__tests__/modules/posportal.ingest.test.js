// src/__tests__/modules/posportal.ingest.test.js
// The inbound pipeline, and the four ways it is allowed to not-quite-work.
//
// Every rule under test here exists because the alternative loses an order, and
// an aggregator does not send it twice.

jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  captureAudit: jest.fn(),
}));

// `mock`-prefixed so jest allows the factory to close over it.
let mockUuidCounter = 0;
jest.mock('uuid', () => ({ v4: jest.fn(() => `uuid-${++mockUuidCounter}`) }));

const mockConnection = { execute: jest.fn() };
jest.mock('../../utils/dbHelper', () => ({
  withConnection: jest.fn(async (cb) => cb(mockConnection)),
  withTransaction: jest.fn(async (cb) => cb(mockConnection)),
  findOneOrFail: jest.fn(),
  findAll: jest.fn(),
  executeQuery: jest.fn(),
}));

jest.mock('../../modules/pricing/pricing.service', () => ({
  priceCostInfos: jest.fn(),
}));

const pricingService = require('../../modules/pricing/pricing.service');
const { ingest, hashPayload } = require('../../modules/posportal/posportal.ingest.service');

const TENANT = 'tenant-1';
const PORTAL = {
  Id: 'portal-zo', Code: 'ZOMATO', Name: 'Zomato', Adapter: 'manual', CommissionPct: 18,
};

const breakdown = (id, gross) => ({
  costInfoId: id, found: true, taxGroupId: 'tg1', taxGroupName: 'GST 5%',
  unitAmount: gross, netAmount: gross / 1.05, taxAmount: gross - gross / 1.05,
  grossAmount: gross, effectiveRate: 5, isTaxIncluded: true, components: [],
});

// A hand-keyed order arrives already in the canonical envelope, which is what
// makes the manual adapter the right harness for the pipeline itself.
const payload = (over = {}) => ({
  externalRef: 'ZO-1',
  externalStoreId: 'STORE-A',
  prepaid: true,
  customer: { name: 'Aarti K.', phone: '+91••4417' },
  lines: [{ externalItemId: 'ext-1', name: 'Paneer Tikka', qty: 2, unitPrice: 190 }],
  totals: { gross: 380 },
  ...over,
});

/**
 * Routes every query the pipeline makes. Options let one test change one
 * answer, so each case says exactly what makes it different.
 */
const routeDb = ({ duplicate = null, mapping = { Id: 'map-1', BranchDetailId: 'branch-1' }, listing = { Id: 'lst-1', ItemMetaId: 'im-1', ItemDetailId: 'id-1', ListedName: 'Paneer Tikka', PriceOverrideCostInfoId: 'ci-zo', BaseCostInfoId: 'ci-base' } } = {}) => {
  mockConnection.execute.mockImplementation((sql) => {
    if (/FROM pos_portal_event/i.test(sql) && /PayloadHash/i.test(sql)) {
      return Promise.resolve([duplicate ? [duplicate] : []]);
    }
    if (/FROM pos_portal_branch WHERE PortalId/i.test(sql)) {
      return Promise.resolve([mapping ? [mapping] : []]);
    }
    if (/FROM pos_portal_listing l/i.test(sql)) {
      return Promise.resolve([listing ? [listing] : []]);
    }
    return Promise.resolve([{ affectedRows: 1 }]);
  });
};

const executed = (fragment) => mockConnection.execute.mock.calls
  .filter(([sql]) => new RegExp(fragment, 'i').test(sql));

const insertedOrder = () => {
  const call = executed('INSERT INTO pos_online_order')[0];
  return call ? call[1] : null;
};

// Bind positions of POS_ONLINE_ORDER.INSERT, named rather than indexed so a new
// column shifts nothing about what these tests mean.
const COL = {
  PortalId: 2, Platform: 3, OrderId: 4, PortalBranchId: 5, ExternalRef: 6, Status: 7,
  Payload: 8, Lines: 9, HasUnmappedLines: 10, CustomerName: 11,
  ItemsTotal: 14, GrossAmount: 19, CommissionAmount: 20, NetPayout: 21,
  BranchDetailId: 33,
};
const col = (name) => insertedOrder()[COL[name]];

beforeEach(() => {
  jest.clearAllMocks();
  mockUuidCounter = 0;
  pricingService.priceCostInfos.mockResolvedValue(new Map([['ci-zo', breakdown('ci-zo', 230)]]));
});

describe('the happy path', () => {
  it('records the event, then the order', async () => {
    routeDb();
    const result = await ingest({ portal: PORTAL, payload: payload(), tenantId: TENANT });

    expect(result.status).toBe('processed');
    expect(executed('INSERT INTO pos_portal_event')).toHaveLength(1);
    expect(executed('INSERT INTO pos_online_order')).toHaveLength(1);
  });

  // The dedupe row must be written BEFORE the work, or a retry that arrives
  // mid-flight does the work a second time.
  it('writes the event row before the order row', async () => {
    routeDb();
    await ingest({ portal: PORTAL, payload: payload(), tenantId: TENANT });

    const order = mockConnection.execute.mock.calls
      .findIndex(([sql]) => /INSERT INTO pos_online_order/i.test(sql));
    const event = mockConnection.execute.mock.calls
      .findIndex(([sql]) => /INSERT INTO pos_portal_event/i.test(sql));
    expect(event).toBeLessThan(order);
  });

  // Renaming or retiring a portal must never rewrite what last quarter's orders
  // say they came from — the same reasoning as pos_order.TableName.
  it('snapshots the portal name AND keys the row on the portal id', async () => {
    routeDb();
    await ingest({ portal: PORTAL, payload: payload(), tenantId: TENANT });

    expect(col('PortalId')).toBe('portal-zo');
    expect(col('Platform')).toBe('Zomato');
  });

  it('resolves the branch through the store mapping', async () => {
    routeDb();
    await ingest({ portal: PORTAL, payload: payload(), tenantId: TENANT });

    expect(col('BranchDetailId')).toBe('branch-1');
    expect(col('PortalBranchId')).toBe('map-1');
  });

  // The line is priced through the OVERRIDE, which is the whole reason a
  // per-portal price exists: the bill must be raised at what the customer paid
  // on the portal, not at the dine-in price they never saw.
  it('prices a mapped line through the portal price override', async () => {
    routeDb();
    await ingest({ portal: PORTAL, payload: payload(), tenantId: TENANT });

    const lines = JSON.parse(col('Lines'));
    expect(lines[0].unmapped).toBe(false);
    expect(lines[0].CostInfoId).toBe('ci-zo');
    expect(lines[0].PriceSource).toBe('override');
    expect(lines[0].grossAmount).toBe(460); // 230 × 2
  });

  it('arrives as new, awaiting a human decision', async () => {
    routeDb();
    await ingest({ portal: PORTAL, payload: payload(), tenantId: TENANT });
    expect(col('Status')).toBe('new');
  });
});

describe('commission and payout', () => {
  // The portal is the authority on its own commission.
  it('uses the figure the portal stated when it sent one', async () => {
    routeDb();
    await ingest({
      portal: PORTAL,
      payload: payload({ totals: { gross: 1000, commission: 137, netPayout: 863 } }),
      tenantId: TENANT,
    });
    expect(Number(col('CommissionAmount'))).toBe(137);
    expect(Number(col('NetPayout'))).toBe(863);
  });

  // ...and falls back to the configured rate, so a queue can still show a net
  // payout for a portal whose webhook does not carry one.
  it('computes it from the portal rate when the payload is silent', async () => {
    routeDb();
    await ingest({
      portal: PORTAL, payload: payload({ totals: { gross: 1000 } }), tenantId: TENANT,
    });
    expect(Number(col('CommissionAmount'))).toBe(180); // 18% of 1000
    expect(Number(col('NetPayout'))).toBe(820);
  });
});

describe('the failure lane — recoverable beats lost', () => {
  // Every aggregator retries, and some fan out to several endpoints. Without
  // this the restaurant cooks one order twice and posts it to the ledger twice.
  it('recognises a byte-identical replay and does no work', async () => {
    routeDb({ duplicate: { Id: 'evt-1', OnlineOrderId: 'ord-1', ProcessingStatus: 'processed' } });
    const result = await ingest({ portal: PORTAL, payload: payload(), tenantId: TENANT });

    expect(result).toMatchObject({ status: 'duplicate', duplicate: true, onlineOrderId: 'ord-1' });
    expect(executed('INSERT INTO pos_online_order')).toHaveLength(0);
    expect(executed('INSERT INTO pos_portal_event')).toHaveLength(0);
  });

  // Keying on the ref alone would drop real updates; hashing the body means a
  // CHANGED order for the same ref is still processed.
  it('hashes the body, so a changed order for the same ref is not a replay', () => {
    const a = hashPayload({ externalRef: 'ZO-1', total: 100 });
    const b = hashPayload({ externalRef: 'ZO-1', total: 200 });
    expect(a).not.toBe(b);
    expect(hashPayload({ externalRef: 'ZO-1', total: 100 })).toBe(a);
  });

  // An order dropped because a join table was missing a row is a customer whose
  // food never arrives. It is parked for a human instead.
  it('parks an order from an unknown store instead of dropping it', async () => {
    routeDb({ mapping: null });
    const result = await ingest({ portal: PORTAL, payload: payload(), tenantId: TENANT });

    expect(result.status).toBe('needs_mapping');
    expect(executed('INSERT INTO pos_online_order')).toHaveLength(0);
    // Still recorded, so it can be replayed once the store is mapped.
    expect(executed('INSERT INTO pos_portal_event')).toHaveLength(1);
    const [status, error] = executed('UPDATE pos_portal_event SET ProcessingStatus')[0][1];
    expect(status).toBe('needs_mapping');
    expect(error).toMatch(/STORE-A/);
  });

  // Portal catalogues drift; a new combo appears before anyone maps it.
  // Rejecting the whole order over one line sends a customer away hungry.
  it('keeps an unrecognised line, flags the order, and accepts the rest', async () => {
    routeDb({ listing: null });
    const result = await ingest({ portal: PORTAL, payload: payload(), tenantId: TENANT });

    expect(result.status).toBe('processed');
    expect(col('HasUnmappedLines')).toBe(1);

    const lines = JSON.parse(col('Lines'));
    expect(lines[0].unmapped).toBe(true);
    // The portal's own name and price are kept, so the card still shows what
    // the customer actually ordered and paid.
    expect(lines[0].name).toBe('Paneer Tikka');
    expect(lines[0].grossAmount).toBe(380); // 190 × 2, as the portal priced it
  });
});
