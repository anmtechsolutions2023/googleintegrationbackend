// Unit tests for the master-data bootstrap orchestrator.
// Mocks withTransaction + every participating module service so we can assert
// insertion ORDER and FOREIGN-KEY WIRING precisely, plus rollback propagation.

const dbHelper = require('../../utils/dbHelper');

jest.mock('../../utils/dbHelper', () => ({
  withTransaction: jest.fn(),
}));

// Each mocked service returns { id: '<name>-id', ...data } so we can trace wiring.
const mk = (name) => ({ createTx: jest.fn(async (_conn, data) => ({ id: `${name}-id`, ...data })) });
jest.mock('../../modules/organization/organization.service', () => ({ createTx: jest.fn(async (_c, d) => ({ id: 'org-id', ...d })) }));
jest.mock('../../modules/contactaddresstype/contactaddresstype.service', () => ({
  createTx: jest.fn(async (_c, d) => ({ id: 'addrtype-id', ...d })),
  getOrCreateByNameTx: jest.fn(async (_c, name) => ({ id: 'addrtype-id', Name: name, reused: false })),
}));
jest.mock('../../modules/mapprovider/mapprovider.service', () => ({ createTx: jest.fn(async (_c, d) => ({ id: 'provider-id', ...d })) }));
jest.mock('../../modules/locationdetail/locationdetail.service', () => ({ createTx: jest.fn(async (_c, d) => ({ id: 'location-id', ...d })) }));
jest.mock('../../modules/mapproviderlocationmapper/mapproviderlocationmapper.service', () => ({ createTx: jest.fn(async (_c, d) => ({ id: 'mapper-id', ...d })) }));
jest.mock('../../modules/addressdetail/addressdetail.service', () => ({ createTx: jest.fn(async (_c, d) => ({ id: 'address-id', ...d })) }));
jest.mock('../../modules/contactdetail/contactdetail.service', () => ({ createTx: jest.fn(async (_c, d) => ({ id: 'contact-id', ...d })) }));
jest.mock('../../modules/transactiontypeconfig/transactiontypeconfig.service', () => ({
  createTx: jest.fn(async (_c, d) => ({ id: 'ttc-id', ...d })),
  getOrCreateByTagNameTx: jest.fn(async (_c, d) => ({ id: 'ttc-id', ...d, reused: false })),
}));
jest.mock('../../modules/branchdetail/branchdetail.service', () => ({ createTx: jest.fn(async (_c, d) => ({ id: 'branch-id', ...d })) }));
jest.mock('../../modules/taxgroup/taxgroup.service', () => ({ createTx: jest.fn(async (_c, d) => ({ id: 'tax-id', ...d })) }));
jest.mock('../../modules/costinfo/costinfo.service', () => ({ createTx: jest.fn(async (_c, d) => ({ id: 'cost-id', ...d })) }));
jest.mock('../../modules/category/category.service', () => ({ createTx: jest.fn(async (_c, d) => ({ id: 'cat-id', ...d })) }));
jest.mock('../../modules/uom/uom.service', () => ({ createTx: jest.fn(async (_c, d) => ({ id: 'uom-id', ...d })) }));
jest.mock('../../modules/itemdetail/itemdetail.service', () => ({ createTx: jest.fn(async (_c, d) => ({ id: 'item-id', ...d })) }));
// Setup-state repository — mocked like every other collaborator so this stays a
// pure orchestrator unit test. Defaults to "not yet set up" so bootstrap runs.
jest.mock('../../modules/mastersetup/mastersetup.repository', () => ({
  isSetupComplete: jest.fn(async () => false),
  markCompletedTx: jest.fn(async () => undefined),
  getStatus: jest.fn(),
}));

const service = require('../../modules/mastersetup/mastersetup.service');
const setupRepository = require('../../modules/mastersetup/mastersetup.repository');
const organization = require('../../modules/organization/organization.service');
const mapProvider = require('../../modules/mapprovider/mapprovider.service');
const contactAddressType = require('../../modules/contactaddresstype/contactaddresstype.service');
const transactionTypeConfig = require('../../modules/transactiontypeconfig/transactiontypeconfig.service');
const locationDetail = require('../../modules/locationdetail/locationdetail.service');
const mapProviderLocationMapper = require('../../modules/mapproviderlocationmapper/mapproviderlocationmapper.service');
const addressDetail = require('../../modules/addressdetail/addressdetail.service');
const branchDetail = require('../../modules/branchdetail/branchdetail.service');
const costInfo = require('../../modules/costinfo/costinfo.service');
const itemDetail = require('../../modules/itemdetail/itemdetail.service');

const FAKE_CONN = { fake: 'conn' };
const TENANT = 'tenant-1';
const USER = 'admin@test.com';

const payload = () => ({
  organization: { Name: 'ANM Tech' },
  branch: {
    Name: 'Main Branch',
    address: {
      AddressLine1: '12 MG Road', TagName: 'HQ',
      contactAddressType: { Name: 'Onboarding' },
      locationMapper: {
        TagName: 'HQ-LOC',
        mapProvider: { ProviderName: 'Google' },
        locationDetail: { Lat: 12.97, Lng: 77.59 },
      },
    },
    contact: { FirstName: 'Ravi', LastName: 'K' },
    transactionTypeConfig: { StartCounterNo: 1, Format: 'INV-{0000}', TagName: 'Onboarding' },
  },
  item: {
    Name: 'Masala Dosa',
    category: { Name: 'South Indian' },
    uom: { UnitName: 'Plate' },
    costInfo: { Amount: 120, taxGroup: { Name: 'GST5' } },
  },
});

describe('mastersetup.service — bootstrap orchestrator', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // withTransaction just runs the callback with a fake connection.
    dbHelper.withTransaction.mockImplementation((cb) => cb(FAKE_CONN));
    // Default: tenant has not completed setup, so bootstrap is allowed to run.
    setupRepository.isSetupComplete.mockResolvedValue(false);
    setupRepository.markCompletedTx.mockResolvedValue(undefined);
  });

  it('returns an id map for every created entity', async () => {
    const ids = await service.bootstrap(payload(), TENANT, USER);
    expect(ids).toMatchObject({
      organization: 'org-id', branch: 'branch-id',
      address: 'address-id', contactAddressType: 'addrtype-id', locationMapper: 'mapper-id',
      mapProvider: 'provider-id', locationDetail: 'location-id',
      contact: 'contact-id', transactionTypeConfig: 'ttc-id',
      item: 'item-id', category: 'cat-id', uom: 'uom-id', costInfo: 'cost-id', taxGroup: 'tax-id',
    });
  });

  it('wires resolved foreign keys into each dependent insert', async () => {
    await service.bootstrap(payload(), TENANT, USER);

    // location mapper gets provider + location ids
    expect(mapProviderLocationMapper.createTx).toHaveBeenCalledWith(
      FAKE_CONN, expect.objectContaining({ MapProviderId: 'provider-id', LocationDetailId: 'location-id' }), TENANT, USER,
    );
    // address gets mapper + address-type ids
    expect(addressDetail.createTx).toHaveBeenCalledWith(
      FAKE_CONN, expect.objectContaining({ MapProviderLocationMapperId: 'mapper-id', ContactAddressTypeId: 'addrtype-id' }), TENANT, USER,
    );
    // branch gets all four FKs
    expect(branchDetail.createTx).toHaveBeenCalledWith(
      FAKE_CONN,
      expect.objectContaining({
        OrganizationDetailId: 'org-id', ContactDetailId: 'contact-id',
        AddressDetailId: 'address-id', TransactionTypeConfigId: 'ttc-id',
      }),
      TENANT, USER,
    );
    // cost info gets tax group; item gets category/uom/cost
    expect(costInfo.createTx).toHaveBeenCalledWith(FAKE_CONN, expect.objectContaining({ TaxGroupId: 'tax-id' }), TENANT, USER);
    expect(itemDetail.createTx).toHaveBeenCalledWith(
      FAKE_CONN, expect.objectContaining({ CategoryId: 'cat-id', UOMId: 'uom-id', CostInfoId: 'cost-id' }), TENANT, USER,
    );
  });

  it('runs entirely inside a single transaction', async () => {
    await service.bootstrap(payload(), TENANT, USER);
    expect(dbHelper.withTransaction).toHaveBeenCalledTimes(1);
  });

  it('skips the item subtree when item is omitted', async () => {
    const p = payload();
    delete p.item;
    const ids = await service.bootstrap(p, TENANT, USER);
    expect(ids.item).toBeUndefined();
    expect(itemDetail.createTx).not.toHaveBeenCalled();
    expect(branchDetail.createTx).toHaveBeenCalledTimes(1);
  });

  it('get-or-creates the address type by name (reuses instead of always inserting)', async () => {
    await service.bootstrap(payload(), TENANT, USER);
    // resolves the address type via get-or-create using the payload's name
    expect(contactAddressType.getOrCreateByNameTx).toHaveBeenCalledWith(
      FAKE_CONN, 'Onboarding', TENANT, USER,
    );
    // and never falls back to a blind create for the address type
    expect(contactAddressType.createTx).not.toHaveBeenCalled();
    // the resolved id is wired into the address
    expect(addressDetail.createTx).toHaveBeenCalledWith(
      FAKE_CONN, expect.objectContaining({ ContactAddressTypeId: 'addrtype-id' }), TENANT, USER,
    );
  });

  it('get-or-creates the transaction type config by TagName (reuses instead of always inserting)', async () => {
    await service.bootstrap(payload(), TENANT, USER);
    // resolves the txn-config via get-or-create using the payload (TagName 'Onboarding')
    expect(transactionTypeConfig.getOrCreateByTagNameTx).toHaveBeenCalledWith(
      FAKE_CONN,
      expect.objectContaining({ TagName: 'Onboarding' }),
      TENANT, USER,
    );
    // and never falls back to a blind create for the txn-config
    expect(transactionTypeConfig.createTx).not.toHaveBeenCalled();
    // the resolved id is wired into the branch
    expect(branchDetail.createTx).toHaveBeenCalledWith(
      FAKE_CONN, expect.objectContaining({ TransactionTypeConfigId: 'ttc-id' }), TENANT, USER,
    );
  });

  it('skips the location mapper chain when locationMapper is omitted', async () => {
    const p = payload();
    delete p.branch.address.locationMapper;
    const ids = await service.bootstrap(p, TENANT, USER);

    // none of the location chain entities were created
    expect(ids.locationMapper).toBeUndefined();
    expect(ids.mapProvider).toBeUndefined();
    expect(ids.locationDetail).toBeUndefined();
    expect(mapProvider.createTx).not.toHaveBeenCalled();
    expect(locationDetail.createTx).not.toHaveBeenCalled();
    expect(mapProviderLocationMapper.createTx).not.toHaveBeenCalled();

    // address is still created, with a null location-mapper FK
    expect(addressDetail.createTx).toHaveBeenCalledWith(
      FAKE_CONN,
      expect.objectContaining({ MapProviderLocationMapperId: null, ContactAddressTypeId: 'addrtype-id' }),
      TENANT, USER,
    );
    // branch still created (address type + address remain mandatory)
    expect(branchDetail.createTx).toHaveBeenCalledTimes(1);
  });

  it('propagates a mid-tree failure (so withTransaction can roll back)', async () => {
    branchDetail.createTx.mockRejectedValueOnce(new Error('branch insert failed'));
    await expect(service.bootstrap(payload(), TENANT, USER)).rejects.toThrow('branch insert failed');
    // item subtree never ran because branch threw first
    expect(itemDetail.createTx).not.toHaveBeenCalled();
  });

  // ── First-time setup gate ──────────────────────────────────────────────────
  describe('tenancy setup completion', () => {
    it('marks the tenant COMPLETED on the same transaction connection', async () => {
      await service.bootstrap(payload(), TENANT, USER);
      // Same FAKE_CONN as every insert — the flag must commit or roll back with
      // the data it describes, never independently of it.
      expect(setupRepository.markCompletedTx).toHaveBeenCalledWith(FAKE_CONN, TENANT, USER);
      expect(setupRepository.markCompletedTx).toHaveBeenCalledTimes(1);
    });

    it('does not mark the tenant complete when the tree fails midway', async () => {
      branchDetail.createTx.mockRejectedValueOnce(new Error('branch insert failed'));
      await expect(service.bootstrap(payload(), TENANT, USER)).rejects.toThrow();
      // A rolled-back bootstrap must leave the tenant gated.
      expect(setupRepository.markCompletedTx).not.toHaveBeenCalled();
    });

    it('rejects a second bootstrap with 409 and creates nothing', async () => {
      setupRepository.isSetupComplete.mockResolvedValue(true);

      await expect(service.bootstrap(payload(), TENANT, USER)).rejects.toMatchObject({
        statusCode: 409,
      });

      // Guard runs before the transaction opens — no duplicate org/branch tree.
      expect(dbHelper.withTransaction).not.toHaveBeenCalled();
      expect(organization.createTx).not.toHaveBeenCalled();
      expect(branchDetail.createTx).not.toHaveBeenCalled();
    });
  });

  describe('getStatus', () => {
    it('delegates to the setup repository', async () => {
      const expected = { tenantId: TENANT, status: 'COMPLETED', isComplete: true };
      setupRepository.getStatus.mockResolvedValue(expected);

      await expect(service.getStatus(TENANT)).resolves.toEqual(expected);
      expect(setupRepository.getStatus).toHaveBeenCalledWith(TENANT);
    });
  });
});
