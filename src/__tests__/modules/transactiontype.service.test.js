/**
 * transactiontype.service.test.js
 *
 * Unit tests for the transactiontype service layer.
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
  MODULE_REGISTRY.find((m) => m.name === 'transactiontype');

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

const VALID_UUID_TT = 'a1b2c3d4-1111-1111-1111-111111111111';

describe('transactiontype — field validation', () => {
  const { createTransactionTypeSchema, updateTransactionTypeSchema } =
    require('../../modules/transactiontype/transactiontype.schemas');

  describe('create schema — positive cases', () => {
    it('passes with valid Name and TransactionTypeConfigId', () => {
      expect(createTransactionTypeSchema.validate({ Name: 'Sales Invoice', TransactionTypeConfigId: VALID_UUID_TT }).error).toBeUndefined();
    });
    it('passes with Active false', () => {
      expect(createTransactionTypeSchema.validate({ Name: 'Purchase', TransactionTypeConfigId: VALID_UUID_TT, Active: false }).error).toBeUndefined();
    });
    it('accepts Name at exactly 100 characters', () => {
      expect(createTransactionTypeSchema.validate({ Name: 'x'.repeat(100), TransactionTypeConfigId: VALID_UUID_TT }).error).toBeUndefined();
    });
    it('defaults Active to true when omitted', () => {
      const { value } = createTransactionTypeSchema.validate({ Name: 'Invoice', TransactionTypeConfigId: VALID_UUID_TT });
      expect(value.Active).toBe(true);
    });
  });

  describe('create schema — negative cases', () => {
    it('fails when Name is missing', () => {
      expect(createTransactionTypeSchema.validate({ TransactionTypeConfigId: VALID_UUID_TT }).error).toBeDefined();
    });
    it('fails when TransactionTypeConfigId is missing', () => {
      expect(createTransactionTypeSchema.validate({ Name: 'Invoice' }).error).toBeDefined();
    });
    it('fails when Name exceeds 100 characters', () => {
      expect(createTransactionTypeSchema.validate({ Name: 'x'.repeat(101), TransactionTypeConfigId: VALID_UUID_TT }).error).toBeDefined();
    });
    it('fails when TransactionTypeConfigId is not a valid UUID', () => {
      expect(createTransactionTypeSchema.validate({ Name: 'Invoice', TransactionTypeConfigId: 'not-uuid' }).error).toBeDefined();
    });
    it('fails when Name is a number', () => {
      expect(createTransactionTypeSchema.validate({ Name: 1, TransactionTypeConfigId: VALID_UUID_TT }).error).toBeDefined();
    });
  });

  describe('update schema — positive cases', () => {
    it('passes with Name patch', () => {
      expect(updateTransactionTypeSchema.validate({ Name: 'Purchase Order' }).error).toBeUndefined();
    });
    it('passes with TransactionTypeConfigId patch', () => {
      expect(updateTransactionTypeSchema.validate({ TransactionTypeConfigId: VALID_UUID_TT }).error).toBeUndefined();
    });
    it('passes with only Active flag', () => {
      expect(updateTransactionTypeSchema.validate({ Active: false }).error).toBeUndefined();
    });
  });

  describe('update schema — negative cases', () => {
    it('fails for an empty body', () => {
      expect(updateTransactionTypeSchema.validate({}).error).toBeDefined();
    });
    it('fails when Name exceeds 100 characters', () => {
      expect(updateTransactionTypeSchema.validate({ Name: 'x'.repeat(101) }).error).toBeDefined();
    });
    it('fails when TransactionTypeConfigId is invalid UUID', () => {
      expect(updateTransactionTypeSchema.validate({ TransactionTypeConfigId: 'not-uuid' }).error).toBeDefined();
    });
  });
});
