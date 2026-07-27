/**
 * pos.service.test.js
 *
 * Unit tests for all POS (Front Desk) module services.
 * Driven by the shared moduleRegistry — one describe block per POS module.
 * DB is fully mocked — no real database connections.
 */

jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  captureAudit: jest.fn(),
}));

jest.mock('uuid', () => ({ v4: jest.fn(() => 'mock-uuid-generated') }));

const {
  createMockConnection,
  setupReadWriteMock,
  setupInsertMock,
  setupNotFoundMock,
  buildExistingRow,
  TENANT_ID,
  RECORD_ID,
} = require('../helpers/mockFactory');

const MODULE_REGISTRY = require('../helpers/moduleRegistry');

const mockConnection = createMockConnection();

jest.mock('../../utils/dbHelper', () => ({
  withConnection:  jest.fn((cb) => cb(mockConnection)),
  withTransaction: jest.fn((cb) => cb(mockConnection)),
  findOneOrFail:   jest.fn(),
  findAll:         jest.fn(),
  executeQuery:    jest.fn(),
}));

const USER_EMAIL = 'test@example.com';
const POS_MODULES = MODULE_REGISTRY.filter((m) => m.name.startsWith('pos'));

beforeEach(() => jest.clearAllMocks());

describe('POS module registry', () => {
  it('registers all 15 POS modules', () => {
    expect(POS_MODULES).toHaveLength(15);
  });
});

POS_MODULES.forEach(({ name, servicePath, exports: ex, createData, updateData, existingRow }) => {
  describe(`${name} — service`, () => {
    const svc = require(servicePath);
    const row = buildExistingRow(existingRow);

    describe('create', () => {
      it('returns a generated id', async () => {
        setupInsertMock(mockConnection);
        const result = await svc[ex.create](createData, TENANT_ID, USER_EMAIL);
        expect(result).toHaveProperty('id');
      });

      it('includes submitted data in the response', async () => {
        setupInsertMock(mockConnection);
        const result = await svc[ex.create](createData, TENANT_ID, USER_EMAIL);
        expect(result).toMatchObject(createData);
      });

      it('never passes undefined params to the DB layer', async () => {
        setupInsertMock(mockConnection);
        await svc[ex.create](createData, TENANT_ID, USER_EMAIL);
        const insertCall = mockConnection.execute.mock.calls.find(([sql]) =>
          /INSERT/i.test(sql)
        );
        expect(insertCall).toBeDefined();
        expect(insertCall[1].some((p) => p === undefined)).toBe(false);
      });
    });

    describe('update', () => {
      it('returns a record with the correct Id', async () => {
        setupReadWriteMock(mockConnection, row);
        const result = await svc[ex.update](RECORD_ID, updateData, TENANT_ID, USER_EMAIL);
        expect(result).toHaveProperty('Id', RECORD_ID);
      });

      it('falls back to existing values when the patch is empty', async () => {
        setupReadWriteMock(mockConnection, row);
        const result = await svc[ex.update](RECORD_ID, {}, TENANT_ID, USER_EMAIL);
        expect(result).toHaveProperty('Id', RECORD_ID);
      });

      it('uses provided values for every field when a full patch is supplied', async () => {
        setupReadWriteMock(mockConnection, row);
        // existingRow carries every entity column → a "full" patch exercises the
        // provided-value branch of each field-fallback ternary.
        const fullPatch = { ...existingRow, Active: false };
        const result = await svc[ex.update](RECORD_ID, fullPatch, TENANT_ID, USER_EMAIL);
        expect(result).toHaveProperty('Id', RECORD_ID);
      });
    });

    describe('getAll', () => {
      it('returns a data array and pagination', async () => {
        setupReadWriteMock(mockConnection, row);
        const result = await svc[ex.getAll](TENANT_ID, 1, 10, false);
        expect(Array.isArray(result.data)).toBe(true);
        expect(result).toHaveProperty('pagination');
      });

      it('throws when tenantId is missing', async () => {
        await expect(svc[ex.getAll](undefined, 1, 10)).rejects.toThrow();
      });
    });

    describe('getById', () => {
      it('returns the matching record', async () => {
        setupReadWriteMock(mockConnection, row);
        const result = await svc[ex.getById](RECORD_ID, TENANT_ID, false);
        expect(result).toHaveProperty('Id', RECORD_ID);
      });

      it('throws when the record does not exist', async () => {
        setupNotFoundMock(mockConnection);
        await expect(svc[ex.getById](RECORD_ID, TENANT_ID)).rejects.toThrow();
      });
    });

    describe('delete', () => {
      it('resolves when the record exists', async () => {
        setupReadWriteMock(mockConnection, row);
        await expect(svc[ex.delete](RECORD_ID, TENANT_ID)).resolves.toBeUndefined();
      });

      it('throws when the record does not exist', async () => {
        setupNotFoundMock(mockConnection);
        await expect(svc[ex.delete](RECORD_ID, TENANT_ID)).rejects.toThrow();
      });
    });
  });

  describe(`${name} — field validation`, () => {
    const schemas = require(servicePath.replace('.service', '.schemas'));
    const { createSchema, updateSchema } = schemas;

    it('accepts a valid create payload', () => {
      expect(createSchema.validate(createData).error).toBeUndefined();
    });

    it('accepts a valid update payload', () => {
      expect(updateSchema.validate(updateData).error).toBeUndefined();
    });

    it('rejects an empty update payload (min 1 field)', () => {
      expect(updateSchema.validate({}).error).toBeDefined();
    });

    it('rejects unknown/garbage types on update', () => {
      expect(updateSchema.validate({ Active: 'not-a-bool' }).error).toBeDefined();
    });
  });
});

// ── Domain actions (beyond CRUD) ───────────────────────────────────────────
describe('POS domain actions', () => {
  const kotRow = buildExistingRow({ KotNo: 'KOT-1', Status: 'pending', Items: null });
  const billRow = buildExistingRow({ BillNo: 'BILL-1', Status: 'unpaid', Discount: 0, Total: 100, Payments: null });
  const orderRow = buildExistingRow({ OrderNo: 'ORD-1', Status: 'open', TableId: null, Items: null, BranchDetailId: null });

  describe('poskot.markReady', () => {
    const svc = require('../../modules/poskot/poskot.service');

    it('returns the KOT after marking it ready', async () => {
      setupReadWriteMock(mockConnection, { ...kotRow, Status: 'ready' });
      const result = await svc.markReady(RECORD_ID, TENANT_ID, USER_EMAIL);
      expect(result).toHaveProperty('Id', RECORD_ID);
    });

    it('issues an UPDATE with status "ready"', async () => {
      setupReadWriteMock(mockConnection, kotRow);
      await svc.markReady(RECORD_ID, TENANT_ID, USER_EMAIL);
      const statusCall = mockConnection.execute.mock.calls.find(
        ([sql]) => /UPDATE pos_kot SET Status/i.test(sql)
      );
      expect(statusCall).toBeDefined();
      expect(statusCall[1][0]).toBe('ready');
    });

    it('throws when the KOT does not exist', async () => {
      setupNotFoundMock(mockConnection);
      await expect(svc.markReady(RECORD_ID, TENANT_ID, USER_EMAIL)).rejects.toThrow();
    });
  });

  describe('posbill.settle', () => {
    const svc = require('../../modules/posbill/posbill.service');

    it('settles a bill and returns it', async () => {
      setupReadWriteMock(mockConnection, { ...billRow, Status: 'paid' });
      const result = await svc.settle(RECORD_ID, { Payments: [{ mode: 'cash', amount: 100 }] }, TENANT_ID, USER_EMAIL);
      expect(result).toHaveProperty('Id', RECORD_ID);
    });

    it('marks the bill paid via the SETTLE query', async () => {
      setupReadWriteMock(mockConnection, billRow);
      await svc.settle(RECORD_ID, { Payments: [{ mode: 'card', amount: 100 }] }, TENANT_ID, USER_EMAIL);
      const settleCall = mockConnection.execute.mock.calls.find(
        ([sql]) => /UPDATE pos_bill SET Payments/i.test(sql)
      );
      expect(settleCall).toBeDefined();
      expect(settleCall[1]).toContain('paid');
    });

    it('throws when the bill does not exist', async () => {
      setupNotFoundMock(mockConnection);
      await expect(
        svc.settle(RECORD_ID, { Payments: [] }, TENANT_ID, USER_EMAIL)
      ).rejects.toThrow();
    });

    it('rejects a settle payload without Payments (schema)', () => {
      const { settleSchema } = require('../../modules/posbill/posbill.schemas');
      expect(settleSchema.validate({}).error).toBeDefined();
    });
  });

  describe('posorder.fireKot', () => {
    const svc = require('../../modules/posorder/posorder.service');

    it('creates a KOT and returns its summary', async () => {
      setupReadWriteMock(mockConnection, orderRow);
      const result = await svc.fireKot(RECORD_ID, {}, TENANT_ID, USER_EMAIL);
      expect(result).toHaveProperty('OrderId', RECORD_ID);
      expect(result).toHaveProperty('KotId');
      expect(result.Status).toBe('pending');
    });

    it('inserts into pos_kot and marks the order fired', async () => {
      setupReadWriteMock(mockConnection, orderRow);
      await svc.fireKot(RECORD_ID, { KotNo: 'KOT-99' }, TENANT_ID, USER_EMAIL);
      const kotInsert = mockConnection.execute.mock.calls.find(
        ([sql]) => /INSERT INTO pos_kot/i.test(sql)
      );
      const orderStatus = mockConnection.execute.mock.calls.find(
        ([sql]) => /UPDATE pos_order SET Status/i.test(sql)
      );
      expect(kotInsert).toBeDefined();
      expect(orderStatus).toBeDefined();
      expect(orderStatus[1][0]).toBe('fired');
    });

    it('throws when the order does not exist', async () => {
      setupNotFoundMock(mockConnection);
      await expect(svc.fireKot(RECORD_ID, {}, TENANT_ID, USER_EMAIL)).rejects.toThrow();
    });
  });
});

// ── positemmeta channel/variant join-table sync ─────────────────────────────
describe('positemmeta join-table sync', () => {
  const svc = require('../../modules/positemmeta/positemmeta.service');
  const CHAN_A = 'aaaaaaaa-0000-0000-0000-000000000001';
  const CHAN_B = 'aaaaaaaa-0000-0000-0000-000000000002';
  const VAR_A  = 'bbbbbbbb-0000-0000-0000-000000000001';

  it('inserts a channel/variant link row per id on create', async () => {
    setupInsertMock(mockConnection);
    await svc.create(
      { ItemDetailId: RECORD_ID, FoodType: 'veg', BranchDetailId: RECORD_ID, ChannelIds: [CHAN_A, CHAN_B], VariantIds: [VAR_A] },
      TENANT_ID,
      USER_EMAIL,
    );
    const chanInserts = mockConnection.execute.mock.calls.filter(
      ([sql]) => /INSERT INTO pos_item_meta_channel/i.test(sql)
    );
    const varInserts = mockConnection.execute.mock.calls.filter(
      ([sql]) => /INSERT INTO pos_item_meta_variant/i.test(sql)
    );
    expect(chanInserts).toHaveLength(2);
    expect(varInserts).toHaveLength(1);
  });

  it('clears existing links before re-inserting on update', async () => {
    setupReadWriteMock(mockConnection, buildExistingRow({ ItemDetailId: RECORD_ID, FoodType: 'veg', BranchDetailId: RECORD_ID }));
    await svc.update(RECORD_ID, { ChannelIds: [CHAN_A] }, TENANT_ID, USER_EMAIL);
    const chanDelete = mockConnection.execute.mock.calls.find(
      ([sql]) => /DELETE FROM pos_item_meta_channel/i.test(sql)
    );
    const chanInsert = mockConnection.execute.mock.calls.find(
      ([sql]) => /INSERT INTO pos_item_meta_channel/i.test(sql)
    );
    expect(chanDelete).toBeDefined();
    expect(chanInsert).toBeDefined();
  });

  it('leaves links untouched when ChannelIds/VariantIds are omitted', async () => {
    setupReadWriteMock(mockConnection, buildExistingRow({ ItemDetailId: RECORD_ID, FoodType: 'veg', BranchDetailId: RECORD_ID }));
    await svc.update(RECORD_ID, { FoodType: 'nonveg' }, TENANT_ID, USER_EMAIL);
    const linkTouch = mockConnection.execute.mock.calls.find(
      ([sql]) => /(DELETE FROM|INSERT INTO) pos_item_meta_(channel|variant)/i.test(sql)
    );
    expect(linkTouch).toBeUndefined();
  });
});

// ── positemmeta price derivation ────────────────────────────────────────────
// Price belongs to the master item (itemdetail.CostInfoId → costinfo); the menu
// entry only mirrors it. The Menu Items screen therefore stopped sending
// CostInfoId, and the service reads it off the selected item instead.
describe('positemmeta CostInfoId derivation', () => {
  const svc = require('../../modules/positemmeta/positemmeta.service');
  const ITEM_A = 'cccccccc-0000-0000-0000-00000000000a';
  const ITEM_B = 'cccccccc-0000-0000-0000-00000000000b';
  const COST_A = 'dddddddd-0000-0000-0000-00000000000a';
  const COST_B = 'dddddddd-0000-0000-0000-00000000000b';
  const EXPLICIT_COST = 'eeeeeeee-0000-0000-0000-00000000000e';

  // Answers the itemdetail lookup with a per-item CostInfoId; everything else
  // behaves like the standard insert/read mock.
  const withItemPrices = (prices, existingRow = null) => {
    mockConnection.execute.mockImplementation((sql, params) => {
      if (/FROM itemdetail/i.test(sql)) {
        const id = params[0];
        return Promise.resolve([
          Object.prototype.hasOwnProperty.call(prices, id)
            ? [{ Id: id, CostInfoId: prices[id] }]
            : [],
        ]);
      }
      if (/SELECT/i.test(sql)) {
        return Promise.resolve([existingRow ? [existingRow] : []]);
      }
      return Promise.resolve([{ affectedRows: 1 }]);
    });
  };

  // CostInfoId is the 5th INSERT param (Id, TenantId, ItemDetailId, FoodTypeId, CostInfoId, …)
  const insertedCostInfoId = () => {
    const call = mockConnection.execute.mock.calls.find(
      ([sql]) => /INSERT INTO pos_item_meta\s/i.test(sql)
    );
    return call[1][4];
  };

  // CostInfoId is the 3rd UPDATE param (ItemDetailId, FoodTypeId, CostInfoId, …)
  const updatedCostInfoId = () => {
    const call = mockConnection.execute.mock.calls.find(
      ([sql]) => /UPDATE pos_item_meta SET/i.test(sql)
    );
    return call[1][2];
  };

  it('takes the price from the selected item when CostInfoId is omitted', async () => {
    withItemPrices({ [ITEM_A]: COST_A });
    await svc.create(
      { ItemDetailId: ITEM_A, FoodTypeId: RECORD_ID, BranchDetailId: RECORD_ID },
      TENANT_ID,
      USER_EMAIL,
    );
    expect(insertedCostInfoId()).toBe(COST_A);
  });

  it('reports the derived CostInfoId back in the create response', async () => {
    withItemPrices({ [ITEM_A]: COST_A });
    const result = await svc.create(
      { ItemDetailId: ITEM_A, FoodTypeId: RECORD_ID, BranchDetailId: RECORD_ID },
      TENANT_ID,
      USER_EMAIL,
    );
    expect(result.CostInfoId).toBe(COST_A);
  });

  it('honours an explicit CostInfoId — existing API clients are unaffected', async () => {
    withItemPrices({ [ITEM_A]: COST_A });
    await svc.create(
      {
        ItemDetailId: ITEM_A,
        FoodTypeId: RECORD_ID,
        BranchDetailId: RECORD_ID,
        CostInfoId: EXPLICIT_COST,
      },
      TENANT_ID,
      USER_EMAIL,
    );
    // The caller's value wins over the item's own price.
    expect(insertedCostInfoId()).toBe(EXPLICIT_COST);
  });

  it('honours an explicit null CostInfoId', async () => {
    withItemPrices({ [ITEM_A]: COST_A });
    await svc.create(
      {
        ItemDetailId: ITEM_A,
        FoodTypeId: RECORD_ID,
        BranchDetailId: RECORD_ID,
        CostInfoId: null,
      },
      TENANT_ID,
      USER_EMAIL,
    );
    expect(insertedCostInfoId()).toBeNull();
  });

  it('stores null when the selected item has no price configured', async () => {
    withItemPrices({ [ITEM_A]: null });
    await svc.create(
      { ItemDetailId: ITEM_A, FoodTypeId: RECORD_ID, BranchDetailId: RECORD_ID },
      TENANT_ID,
      USER_EMAIL,
    );
    expect(insertedCostInfoId()).toBeNull();
  });

  it('stores null when the item id does not resolve', async () => {
    withItemPrices({});
    await svc.create(
      { ItemDetailId: ITEM_A, FoodTypeId: RECORD_ID, BranchDetailId: RECORD_ID },
      TENANT_ID,
      USER_EMAIL,
    );
    expect(insertedCostInfoId()).toBeNull();
  });

  it('moves the price with the item when the item is switched on update', async () => {
    const existing = buildExistingRow({ ItemDetailId: ITEM_A, CostInfoId: COST_A });
    withItemPrices({ [ITEM_A]: COST_A, [ITEM_B]: COST_B }, existing);

    await svc.update(RECORD_ID, { ItemDetailId: ITEM_B }, TENANT_ID, USER_EMAIL);

    // The whole point of deriving on update — the stale COST_A must not stick.
    expect(updatedCostInfoId()).toBe(COST_B);
  });

  it('re-derives from the unchanged item when other fields are updated', async () => {
    const existing = buildExistingRow({ ItemDetailId: ITEM_A, CostInfoId: COST_A });
    withItemPrices({ [ITEM_A]: COST_A }, existing);

    await svc.update(RECORD_ID, { Active: false }, TENANT_ID, USER_EMAIL);

    expect(updatedCostInfoId()).toBe(COST_A);
  });

  it('keeps the existing price when the row has no item to derive from', async () => {
    const existing = buildExistingRow({ ItemDetailId: null, CostInfoId: COST_A });
    withItemPrices({}, existing);

    await svc.update(RECORD_ID, { Active: false }, TENANT_ID, USER_EMAIL);

    expect(updatedCostInfoId()).toBe(COST_A);
  });
});

// ── Explicit rules for added/updated schemas ───────────────────────────────
describe('POS updated schema rules', () => {
  it('posfeedback: Rating is required on create', () => {
    const { createSchema } = require('../../modules/posfeedback/posfeedback.schemas');
    expect(createSchema.validate({ CustomerName: 'A' }).error).toBeDefined();
    expect(createSchema.validate({ Rating: 5 }).error).toBeUndefined();
  });

  it('posfeedback: Rating must be within 1..5', () => {
    const { createSchema } = require('../../modules/posfeedback/posfeedback.schemas');
    expect(createSchema.validate({ Rating: 0 }).error).toBeDefined();
    expect(createSchema.validate({ Rating: 6 }).error).toBeDefined();
    expect(createSchema.validate({ Rating: 3 }).error).toBeUndefined();
  });

  it('positemmeta: NOT NULL columns are required on create', () => {
    const { createSchema } = require('../../modules/positemmeta/positemmeta.schemas');
    // Missing FoodTypeId/BranchDetailId → error.
    expect(createSchema.validate({ ItemDetailId: RECORD_ID }).error).toBeDefined();
    const valid = {
      ItemDetailId: RECORD_ID,
      FoodTypeId: RECORD_ID,
      Channels: { dinein: true },
      Prices: { dinein: 100 },
      Variants: [],
      BranchDetailId: RECORD_ID,
    };
    expect(createSchema.validate(valid).error).toBeUndefined();
  });

  it('posbill settleSchema: Payments required, Discount/Total optional', () => {
    const { settleSchema } = require('../../modules/posbill/posbill.schemas');
    expect(settleSchema.validate({}).error).toBeDefined();
    expect(settleSchema.validate({ Payments: [{ mode: 'cash', amount: 100 }] }).error).toBeUndefined();
    expect(settleSchema.validate({ Payments: [], Discount: 10, Total: 90 }).error).toBeUndefined();
  });
});
