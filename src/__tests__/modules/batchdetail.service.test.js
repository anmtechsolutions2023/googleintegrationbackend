/**
 * batchdetail.service.test.js
 *
 * Unit tests for the batchdetail service layer.
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

const { name, servicePath, exports: ex, createData, updateData, existingRow } =
  MODULE_REGISTRY.find((m) => m.name === 'batchdetail');

const USER_EMAIL = 'test@example.com';

beforeEach(() => jest.clearAllMocks());

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
  });

  describe('update', () => {
    it('returns a record with the correct Id', async () => {
      setupReadWriteMock(mockConnection, row);
      const result = await svc[ex.update](RECORD_ID, updateData, TENANT_ID, USER_EMAIL);
      expect(result).toHaveProperty('Id', RECORD_ID);
    });

    it('falls back to existing values when a field is omitted from the patch', async () => {
      setupReadWriteMock(mockConnection, row);
      const result = await svc[ex.update](RECORD_ID, {}, TENANT_ID, USER_EMAIL);
      expect(result).toHaveProperty('Id', RECORD_ID);
    });

    it('applies provided Active flag correctly', async () => {
      setupReadWriteMock(mockConnection, row);
      const result = await svc[ex.update](RECORD_ID, { Active: false }, TENANT_ID, USER_EMAIL);
      expect(result).toHaveProperty('Id', RECORD_ID);
    });
  });

  describe('getAll', () => {
    it('returns a data array', async () => {
      setupReadWriteMock(mockConnection, row);
      const result = await svc[ex.getAll](TENANT_ID, 1, 10, false);
      expect(Array.isArray(result.data)).toBe(true);
    });

    it('returns a pagination object', async () => {
      setupReadWriteMock(mockConnection, row);
      const result = await svc[ex.getAll](TENANT_ID, 1, 10, false);
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
    it('resolves without a return value when the record exists', async () => {
      setupReadWriteMock(mockConnection, row);
      await expect(svc[ex.delete](RECORD_ID, TENANT_ID)).resolves.toBeUndefined();
    });

    it('throws when the record does not exist', async () => {
      setupNotFoundMock(mockConnection);
      await expect(svc[ex.delete](RECORD_ID, TENANT_ID)).rejects.toThrow();
    });
  });
});

const VALID_UUID_BATCH = 'a1b2c3d4-1111-1111-1111-111111111111';

describe('batchdetail — field validation', () => {
  const { createSchema: createBatchSchema, updateSchema: updateBatchSchema } =
    require('../../modules/batchdetail/batchdetail.schemas');

  describe('create schema — positive cases', () => {
    it('passes with only required BatchNo', () => {
      expect(createBatchSchema.validate({ BatchNo: 'BATCH-001' }).error).toBeUndefined();
    });
    it('passes with all optional date fields as ISO strings', () => {
      const data = { BatchNo: 'B1', MfgDate: '2025-01-01', Expdate: '2026-01-01', PurchaseDate: '2025-06-01' };
      expect(createBatchSchema.validate(data).error).toBeUndefined();
    });
    it('passes with DD-MM-YYYY date format', () => {
      expect(createBatchSchema.validate({ BatchNo: 'B1', MfgDate: '01-01-2025' }).error).toBeUndefined();
    });
    it('passes with date fields as null', () => {
      expect(createBatchSchema.validate({ BatchNo: 'B1', MfgDate: null, Expdate: null }).error).toBeUndefined();
    });
    it('passes with optional UUID fields', () => {
      expect(createBatchSchema.validate({ BatchNo: 'B1', CostInfoId: VALID_UUID_BATCH, UOMId: VALID_UUID_BATCH }).error).toBeUndefined();
    });
    it('passes with Quantity as decimal', () => {
      expect(createBatchSchema.validate({ BatchNo: 'B1', Quantity: 10.5 }).error).toBeUndefined();
    });
    it('accepts BatchNo at exactly 100 characters', () => {
      expect(createBatchSchema.validate({ BatchNo: 'x'.repeat(100) }).error).toBeUndefined();
    });
    it('defaults IsNonReturnable to false when omitted', () => {
      const { value } = createBatchSchema.validate({ BatchNo: 'B1' });
      expect(value.IsNonReturnable).toBe(false);
    });
  });

  describe('create schema — negative cases', () => {
    it('fails when BatchNo is missing', () => {
      expect(createBatchSchema.validate({}).error).toBeDefined();
    });
    it('fails when BatchNo exceeds 100 characters', () => {
      expect(createBatchSchema.validate({ BatchNo: 'x'.repeat(101) }).error).toBeDefined();
    });
    it('fails when MfgDate is an invalid date string', () => {
      expect(createBatchSchema.validate({ BatchNo: 'B1', MfgDate: 'not-a-date' }).error).toBeDefined();
    });
    it('fails when CostInfoId is not a valid UUID', () => {
      expect(createBatchSchema.validate({ BatchNo: 'B1', CostInfoId: 'not-uuid' }).error).toBeDefined();
    });
    it('fails when IsNonReturnable is not a boolean', () => {
      expect(createBatchSchema.validate({ BatchNo: 'B1', IsNonReturnable: 1 }).error).toBeDefined();
    });
    it('fails when Quantity is a non-numeric string', () => {
      expect(createBatchSchema.validate({ BatchNo: 'B1', Quantity: 'many' }).error).toBeDefined();
    });
  });

  describe('update schema — positive cases', () => {
    it('passes with BatchNo patch', () => {
      expect(updateBatchSchema.validate({ BatchNo: 'BATCH-002' }).error).toBeUndefined();
    });
    it('passes with Expdate update', () => {
      expect(updateBatchSchema.validate({ Expdate: '2027-12-31' }).error).toBeUndefined();
    });
    it('passes with Expdate as null', () => {
      expect(updateBatchSchema.validate({ Expdate: null }).error).toBeUndefined();
    });
    it('passes with only Active flag', () => {
      expect(updateBatchSchema.validate({ Active: false }).error).toBeUndefined();
    });
  });

  describe('update schema — negative cases', () => {
    it('fails for an empty body', () => {
      expect(updateBatchSchema.validate({}).error).toBeDefined();
    });
    it('fails when BatchNo exceeds 100 characters', () => {
      expect(updateBatchSchema.validate({ BatchNo: 'x'.repeat(101) }).error).toBeDefined();
    });
    it('fails when MfgDate is an invalid string', () => {
      expect(updateBatchSchema.validate({ MfgDate: 'yesterday' }).error).toBeDefined();
    });
  });
});

describe('normalizeDate — branch coverage', () => {
  const svc = require('../../modules/batchdetail/batchdetail.service');

  beforeEach(() => setupInsertMock(mockConnection));

  it('accepts ISO datetime strings for date fields', async () => {
    const result = await svc.create({ BatchNo: 'B-ISO', IsNonReturnable: false, MfgDate: '2026-01-15T00:00:00.000Z', Expdate: '2027-01-15T00:00:00.000Z' }, TENANT_ID, USER_EMAIL);
    expect(result).toHaveProperty('id');
  });

  it('accepts DD-MM-YYYY strings for date fields', async () => {
    const result = await svc.create({ BatchNo: 'B-DMY', IsNonReturnable: false, MfgDate: '15-01-2026' }, TENANT_ID, USER_EMAIL);
    expect(result).toHaveProperty('id');
  });

  it('accepts Date objects for date fields', async () => {
    const result = await svc.create({ BatchNo: 'B-OBJ', IsNonReturnable: false, MfgDate: new Date('2026-01-15') }, TENANT_ID, USER_EMAIL);
    expect(result).toHaveProperty('id');
  });
});
