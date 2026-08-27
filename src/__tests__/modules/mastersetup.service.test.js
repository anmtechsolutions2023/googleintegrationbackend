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
// The rates inside a tax group. Mocked at the leaf like every other
// collaborator, so this stays a pure orchestrator test — taxgroup.components
// has its own.
jest.mock('../../modules/taxtype/taxtype.service', () => ({ createTx: jest.fn(async (_c, d) => ({ id: `taxtype-${String(d.Name).toLowerCase()}-${d.Value}`, ...d })) }));
jest.mock('../../modules/taxgrouptaxtypemapper/taxgrouptaxtypemapper.service', () => ({ createTx: jest.fn(async (_c, d) => ({ id: 'taxmap-id', ...d })) }));
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
// The POS/ledger master provisioner runs raw SQL on the connection; it has its
// own unit test, so here it is mocked to keep this a pure orchestrator test.
jest.mock('../../modules/mastersetup/posMasters.provision', () => ({
  provisionPosMasters: jest.fn(async () => undefined),
}));

const service = require('../../modules/mastersetup/mastersetup.service');
const { provisionPosMasters } = require('../../modules/mastersetup/posMasters.provision');
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
const taxType = require('../../modules/taxtype/taxtype.service');
const taxMapper = require('../../modules/taxgrouptaxtypemapper/taxgrouptaxtypemapper.service');
const taxGroup = require('../../modules/taxgroup/taxgroup.service');

// `execute` answers "nothing found" for every lookup, so the tax-rate path
// takes its create branch. A plain function rather than jest.fn(): resetMocks
// strips implementations off the latter, and every lookup would return
// undefined halfway through the suite.
const FAKE_CONN = { fake: 'conn', execute: async () => [[]] };
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

  it('seeds the POS/ledger masters for the tenant using its numbering config', async () => {
    await service.bootstrap(payload(), TENANT, USER);
    expect(provisionPosMasters).toHaveBeenCalledWith(
      FAKE_CONN, { tenantId: TENANT, configId: 'ttc-id' }, USER,
    );
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
  // ── The rates inside the tax group ─────────────────────────────────────────
  // A tax group is a CONTAINER: the rates live in TaxTypes mapped into it.
  // Creating the container and stopping is what this used to do, so a group
  // named "GST 18%" charged 0% and the starter item's price was wrong from the
  // very first bill — with nothing anywhere to say so.
  describe('tax rates on the starter item', () => {
    const withRates = (taxTypes) => {
      const p = payload();
      p.item.costInfo.taxGroup = { Name: 'GST 18%', ...(taxTypes ? { taxTypes } : {}) };
      return p;
    };

    it('creates the rates the payload states, and maps them into the group', async () => {
      await service.bootstrap(withRates([
        { Name: 'CGST', Value: 9 }, { Name: 'SGST', Value: 9 },
      ]), TENANT, USER);

      expect(taxType.createTx).toHaveBeenCalledWith(
        FAKE_CONN, expect.objectContaining({ Name: 'CGST', Value: '9' }), TENANT, USER,
      );
      expect(taxType.createTx).toHaveBeenCalledWith(
        FAKE_CONN, expect.objectContaining({ Name: 'SGST', Value: '9' }), TENANT, USER,
      );
      expect(taxMapper.createTx).toHaveBeenCalledTimes(2);
      expect(taxMapper.createTx).toHaveBeenCalledWith(
        FAKE_CONN,
        expect.objectContaining({ TaxGroupId: 'tax-id', TaxTypeId: 'taxtype-cgst-9' }),
        TENANT, USER,
      );
    });

    // A menu priced at 0% is the worse failure, so a payload that states no
    // rates gets the same standard split the bulk import applies.
    it('falls back to the standard split when the payload states none', async () => {
      await service.bootstrap(withRates(null), TENANT, USER);

      expect(taxType.createTx).toHaveBeenCalledWith(
        FAKE_CONN, expect.objectContaining({ Name: 'CGST', Value: '2.5' }), TENANT, USER,
      );
      expect(taxType.createTx).toHaveBeenCalledWith(
        FAKE_CONN, expect.objectContaining({ Name: 'SGST', Value: '2.5' }), TENANT, USER,
      );
    });

    // The group NEVER ends up empty. This is the assertion that would have
    // caught the original bug.
    it('never leaves the group without rates', async () => {
      await service.bootstrap(withRates(null), TENANT, USER);
      expect(taxMapper.createTx.mock.calls.length).toBeGreaterThan(0);
    });

    // `taxTypes` is not a taxgroup column. It must be consumed here, not
    // handed to the row insert.
    it('does not pass taxTypes into the taxgroup row', async () => {
      await service.bootstrap(withRates([{ Name: 'IGST', Value: 18 }]), TENANT, USER);
      const [, row] = taxGroup.createTx.mock.calls[0];
      expect(row).toEqual({ Name: 'GST 18%' });
      expect(row.taxTypes).toBeUndefined();
    });

    // Inter-state is one IGST row rather than a split — the shape has to allow
    // it, because the default never will.
    it('takes a single IGST rate for an inter-state group', async () => {
      await service.bootstrap(withRates([{ Name: 'IGST', Value: 18 }]), TENANT, USER);
      expect(taxType.createTx).toHaveBeenCalledTimes(1);
      expect(taxType.createTx).toHaveBeenCalledWith(
        FAKE_CONN, expect.objectContaining({ Name: 'IGST', Value: '18' }), TENANT, USER,
      );
    });

    it('creates the item with no item at all when the payload omits one', async () => {
      const p = payload();
      delete p.item;
      await service.bootstrap(p, TENANT, USER);
      expect(taxType.createTx).not.toHaveBeenCalled();
      expect(taxMapper.createTx).not.toHaveBeenCalled();
    });
  });

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
