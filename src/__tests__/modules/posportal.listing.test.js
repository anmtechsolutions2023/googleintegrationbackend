// src/__tests__/modules/posportal.listing.test.js
// Per-portal listings: the gate, the price resolution, and the bulk operation
// the screen exists for.

jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  captureAudit: jest.fn(),
}));
jest.mock('uuid', () => ({ v4: jest.fn(() => 'mock-uuid') }));

const mockConnection = { execute: jest.fn() };
jest.mock('../../utils/dbHelper', () => ({
  withConnection: jest.fn(async (cb) => cb(mockConnection)),
  withTransaction: jest.fn(async (cb) => cb(mockConnection)),
  findOneOrFail: jest.fn(),
  findAll: jest.fn(),
  executeQuery: jest.fn(),
}));
jest.mock('../../modules/pricing/pricing.service', () => ({ priceCostInfos: jest.fn() }));

const pricingService = require('../../modules/pricing/pricing.service');
const listingService = require('../../modules/posportal/posportal.listing.service');
const { resolveCostInfoId } = require('../../modules/posportal/posportal.pricing');

const TENANT = 'tenant-1';
const USER = 'manager@test.com';

const breakdown = (id, gross) => ({
  costInfoId: id, found: true, taxGroupName: 'GST 5%',
  unitAmount: gross, netAmount: gross / 1.05, taxAmount: gross - gross / 1.05,
  grossAmount: gross, effectiveRate: 5, isTaxIncluded: true, components: [],
});

const executed = (fragment) => mockConnection.execute.mock.calls
  .filter(([sql]) => new RegExp(fragment, 'i').test(sql));

beforeEach(() => {
  jest.clearAllMocks();
  pricingService.priceCostInfos.mockResolvedValue(new Map([
    ['ci-zo', breakdown('ci-zo', 249)],
    ['ci-base', breakdown('ci-base', 210)],
  ]));
});

describe('the channel gate — the coarse switch comes first', () => {
  const routeGate = ({ channelId = 'chan-online', linked = 1 } = {}) => {
    mockConnection.execute.mockImplementation((sql) => {
      if (/FROM pos_portal WHERE Id/i.test(sql)) {
        return Promise.resolve([[{ Id: 'portal-zo', ChannelId: channelId }]]);
      }
      if (/FROM pos_item_meta_channel/i.test(sql)) {
        return Promise.resolve([[{ total: linked }]]);
      }
      return Promise.resolve([{ affectedRows: 1 }]);
    });
  };

  it('lists an item that is sold on the portal channel', async () => {
    routeGate({ linked: 1 });
    await listingService.create(
      { PortalId: 'portal-zo', ItemMetaId: 'im-1' }, TENANT, USER,
    );
    expect(executed('INSERT INTO pos_portal_listing')).toHaveLength(1);
  });

  // A listing for an item that is not sold online is a listing that can never
  // legitimately take an order.
  it('refuses an item that is not on the online channel, and says what to do', async () => {
    routeGate({ linked: 0 });
    await expect(listingService.create(
      { PortalId: 'portal-zo', ItemMetaId: 'im-1' }, TENANT, USER,
    )).rejects.toThrow(/not sold on the online channel/i);
    expect(executed('INSERT INTO pos_portal_listing')).toHaveLength(0);
  });

  // The gate is enforced in the service, not the UI, because the UI is not the
  // only writer — the CSV import and the bulk endpoint reach the same table.
  it('checks the gate before writing, not after', async () => {
    routeGate({ linked: 0 });
    await listingService.create({ PortalId: 'portal-zo', ItemMetaId: 'im-1' }, TENANT, USER)
      .catch(() => {});
    expect(executed('FROM pos_item_meta_channel')).toHaveLength(1);
  });

  // Refusing every listing for a tenant who has not set channels up would make
  // the feature unusable for them rather than safer.
  it('does not block a portal that has no channel yet', async () => {
    routeGate({ channelId: null });
    await listingService.create({ PortalId: 'portal-zo', ItemMetaId: 'im-1' }, TENANT, USER);
    expect(executed('INSERT INTO pos_portal_listing')).toHaveLength(1);
  });
});

describe('price resolution — first hit wins', () => {
  it('prefers the portal override', () => {
    expect(resolveCostInfoId({ PriceOverrideCostInfoId: 'ci-zo', BaseCostInfoId: 'ci-base' }))
      .toEqual({ costInfoId: 'ci-zo', source: 'override' });
  });

  it('inherits the branch price when there is no override', () => {
    expect(resolveCostInfoId({ PriceOverrideCostInfoId: null, BaseCostInfoId: 'ci-base' }))
      .toEqual({ costInfoId: 'ci-base', source: 'branch' });
  });

  // A dish with no price anywhere is a legitimate state, not an error — it just
  // cannot be sold until somebody prices it.
  it('reports no price rather than inventing one', () => {
    expect(resolveCostInfoId({})).toEqual({ costInfoId: null, source: 'none' });
  });

  it('prices a portal catalogue through the tax engine, batched', async () => {
    mockConnection.execute.mockResolvedValue([[
      { Id: 'l1', PortalId: 'portal-zo', ItemMetaId: 'im-1', PriceOverrideCostInfoId: 'ci-zo', BaseCostInfoId: 'ci-base', Active: 1 },
      { Id: 'l2', PortalId: 'portal-zo', ItemMetaId: 'im-2', PriceOverrideCostInfoId: null, BaseCostInfoId: 'ci-base', Active: 1 },
    ]]);

    const rows = await listingService.listByPortal('portal-zo', TENANT);

    // ONE chain query for the whole catalogue, not one per row.
    expect(pricingService.priceCostInfos).toHaveBeenCalledTimes(1);
    expect(rows[0]).toMatchObject({ PriceSource: 'override', EffectiveCostInfoId: 'ci-zo' });
    expect(rows[0].TaxBreakdown.grossAmount).toBe(249);
    // The inherited row is priced too — a blank override is not a blank price.
    expect(rows[1]).toMatchObject({ PriceSource: 'branch' });
    expect(rows[1].TaxBreakdown.grossAmount).toBe(210);
  });
});

describe('bulk availability — the operation the screen exists for', () => {
  it('updates every selected listing on one transaction', async () => {
    mockConnection.execute.mockResolvedValue([{ affectedRows: 1 }]);
    const result = await listingService.setAvailabilityBulk(
      { ListingIds: ['l1', 'l2', 'l3'], Available: false }, TENANT, USER,
    );

    expect(result).toEqual({ updated: 3, Available: false });
    expect(executed('SET Available')).toHaveLength(3);
  });

  // Any change to what the portal shows puts the listing back out of sync, so a
  // stale price cannot sit there marked 'synced' while the portal sells the old one.
  it('marks each one pending, so the screen can say what is out of sync', async () => {
    mockConnection.execute.mockResolvedValue([{ affectedRows: 1 }]);
    await listingService.setAvailabilityBulk(
      { ListingIds: ['l1'], Available: false }, TENANT, USER,
    );
    expect(executed('SET Available')[0][0]).toMatch(/SyncStatus = 'pending'/);
  });

  it('refuses an empty selection rather than updating everything', async () => {
    await expect(listingService.setAvailabilityBulk(
      { ListingIds: [], Available: true }, TENANT, USER,
    )).rejects.toThrow(/No listings selected/);
  });
});

describe('sync results are recorded, never assumed', () => {
  it('writes down what the portal accepted and what it refused', async () => {
    mockConnection.execute.mockResolvedValue([{ affectedRows: 1 }]);
    const result = await listingService.recordSyncResult(
      { synced: ['l1', 'l2'], failed: [{ id: 'l3', error: 'HTTP 422' }] }, TENANT, USER,
    );

    expect(result).toEqual({ synced: 2, failed: 1 });
    const statuses = executed('SET LastSyncedOn').map(([, p]) => p[0]);
    expect(statuses).toEqual(['synced', 'synced', 'failed']);
    const failure = executed('SET LastSyncedOn').find(([, p]) => p[0] === 'failed');
    expect(failure[1][1]).toBe('HTTP 422');
  });
});
