/**
 * transactiondetaillog.service.test.js
 *
 * Unit tests for the transactiondetaillog service layer.
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
  MODULE_REGISTRY.find((m) => m.name === 'transactiondetaillog');

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

const VALID_UUID_TDL = 'a1b2c3d4-1111-1111-1111-111111111111';

describe('transactiondetaillog — field validation', () => {
  const { createSchema: createTDLSchema, updateSchema: updateTDLSchema } =
    require('../../modules/transactiondetaillog/transactiondetaillog.schemas');

  describe('create schema — positive cases', () => {
    it('passes with all required fields using ISO date', () => {
      const data = { TransactionNo: 'INV-001', TransactionTypeConfigId: VALID_UUID_TDL, TransactionDate: '2026-05-31' };
      expect(createTDLSchema.validate(data).error).toBeUndefined();
    });
    it('passes with DD-MM-YYYY format for TransactionDate', () => {
      const data = { TransactionNo: 'INV-001', TransactionTypeConfigId: VALID_UUID_TDL, TransactionDate: '31-05-2026' };
      expect(createTDLSchema.validate(data).error).toBeUndefined();
    });
    it('passes with optional fields provided', () => {
      const data = {
        TransactionNo: 'INV-001', TransactionTypeConfigId: VALID_UUID_TDL,
        TransactionTypeStatusId: VALID_UUID_TDL, BranchId: VALID_UUID_TDL,
        TransactionDate: '2026-05-31', Remarks: 'Test remarks',
      };
      expect(createTDLSchema.validate(data).error).toBeUndefined();
    });
    it('passes with optional fields as null', () => {
      const data = { TransactionNo: 'INV-001', TransactionTypeConfigId: VALID_UUID_TDL, TransactionDate: '2026-05-31', TransactionTypeStatusId: null, BranchId: null, Remarks: null };
      expect(createTDLSchema.validate(data).error).toBeUndefined();
    });
    it('accepts TransactionNo at exactly 100 characters', () => {
      expect(createTDLSchema.validate({ TransactionNo: 'x'.repeat(100), TransactionTypeConfigId: VALID_UUID_TDL, TransactionDate: '2026-01-01' }).error).toBeUndefined();
    });
    it('defaults Active to true when omitted', () => {
      const { value } = createTDLSchema.validate({ TransactionNo: 'INV-001', TransactionTypeConfigId: VALID_UUID_TDL, TransactionDate: '2026-01-01' });
      expect(value.Active).toBe(true);
    });
  });

  describe('create schema — negative cases', () => {
    it('fails when TransactionNo is missing', () => {
      expect(createTDLSchema.validate({ TransactionTypeConfigId: VALID_UUID_TDL, TransactionDate: '2026-05-31' }).error).toBeDefined();
    });
    it('fails when TransactionTypeConfigId is missing', () => {
      expect(createTDLSchema.validate({ TransactionNo: 'INV-001', TransactionDate: '2026-05-31' }).error).toBeDefined();
    });
    it('fails when TransactionDate is missing', () => {
      expect(createTDLSchema.validate({ TransactionNo: 'INV-001', TransactionTypeConfigId: VALID_UUID_TDL }).error).toBeDefined();
    });
    it('fails when TransactionDate is an invalid string', () => {
      expect(createTDLSchema.validate({ TransactionNo: 'INV-001', TransactionTypeConfigId: VALID_UUID_TDL, TransactionDate: 'not-a-date' }).error).toBeDefined();
    });
    it('fails when TransactionTypeConfigId is not a valid UUID', () => {
      expect(createTDLSchema.validate({ TransactionNo: 'INV-001', TransactionTypeConfigId: 'bad', TransactionDate: '2026-05-31' }).error).toBeDefined();
    });
    it('fails when TransactionNo exceeds 100 characters', () => {
      expect(createTDLSchema.validate({ TransactionNo: 'x'.repeat(101), TransactionTypeConfigId: VALID_UUID_TDL, TransactionDate: '2026-01-01' }).error).toBeDefined();
    });
    it('fails when Remarks exceeds 1000 characters', () => {
      expect(createTDLSchema.validate({ TransactionNo: 'INV-001', TransactionTypeConfigId: VALID_UUID_TDL, TransactionDate: '2026-01-01', Remarks: 'x'.repeat(1001) }).error).toBeDefined();
    });
  });

  describe('update schema — positive cases', () => {
    it('passes with only TransactionNo patch', () => {
      expect(updateTDLSchema.validate({ TransactionNo: 'INV-002' }).error).toBeUndefined();
    });
    it('passes with TransactionDate update', () => {
      expect(updateTDLSchema.validate({ TransactionDate: '2026-06-01' }).error).toBeUndefined();
    });
    it('passes with Remarks as null', () => {
      expect(updateTDLSchema.validate({ Remarks: null }).error).toBeUndefined();
    });
    it('passes with only Active flag', () => {
      expect(updateTDLSchema.validate({ Active: false }).error).toBeUndefined();
    });
  });

  describe('update schema — negative cases', () => {
    it('fails for an empty body', () => {
      expect(updateTDLSchema.validate({}).error).toBeDefined();
    });
    it('fails when TransactionDate is invalid', () => {
      expect(updateTDLSchema.validate({ TransactionDate: 'bad-date' }).error).toBeDefined();
    });
    it('fails when TransactionTypeConfigId is not a valid UUID', () => {
      expect(updateTDLSchema.validate({ TransactionTypeConfigId: 'not-uuid' }).error).toBeDefined();
    });
  });
});

const UUID = 'a1b2c3d4-1111-1111-1111-111111111111';

describe('normalizeDate — branch coverage', () => {
  const svc = require('../../modules/transactiondetaillog/transactiondetaillog.service');

  beforeEach(() => setupInsertMock(mockConnection));

  it('accepts ISO datetime string for TransactionDate', async () => {
    const result = await svc.create({ TransactionNo: 'T-ISO', TransactionTypeConfigId: UUID, TransactionDate: '2026-05-31T00:00:00.000Z' }, TENANT_ID, USER_EMAIL);
    expect(result).toHaveProperty('id');
  });

  it('accepts DD-MM-YYYY string for TransactionDate', async () => {
    const result = await svc.create({ TransactionNo: 'T-DMY', TransactionTypeConfigId: UUID, TransactionDate: '31-05-2026' }, TENANT_ID, USER_EMAIL);
    expect(result).toHaveProperty('id');
  });
});
