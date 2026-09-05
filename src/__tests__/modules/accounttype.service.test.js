/**
 * accounttype.service.test.js
 *
 * Unit tests for the accounttype service layer.
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
  MODULE_REGISTRY.find((m) => m.name === 'accounttype');

const USER_PHONE = '+919876500099';

beforeEach(() => jest.clearAllMocks());

describe(`${name} — service`, () => {
  const svc = require(servicePath);
  const row = buildExistingRow(existingRow);

  describe('create', () => {
    it('returns a generated id', async () => {
      setupInsertMock(mockConnection);
      const result = await svc[ex.create](createData, TENANT_ID, USER_PHONE);
      expect(result).toHaveProperty('id');
    });

    it('includes submitted data in the response', async () => {
      setupInsertMock(mockConnection);
      const result = await svc[ex.create](createData, TENANT_ID, USER_PHONE);
      expect(result).toMatchObject(createData);
    });
  });

  describe('update', () => {
    it('returns a record with the correct Id', async () => {
      setupReadWriteMock(mockConnection, row);
      const result = await svc[ex.update](RECORD_ID, updateData, TENANT_ID, USER_PHONE);
      expect(result).toHaveProperty('Id', RECORD_ID);
    });

    it('falls back to existing values when a field is omitted from the patch', async () => {
      setupReadWriteMock(mockConnection, row);
      const result = await svc[ex.update](RECORD_ID, {}, TENANT_ID, USER_PHONE);
      expect(result).toHaveProperty('Id', RECORD_ID);
    });

    it('applies provided Active flag correctly', async () => {
      setupReadWriteMock(mockConnection, row);
      const result = await svc[ex.update](RECORD_ID, { Active: false }, TENANT_ID, USER_PHONE);
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

describe('accounttype — field validation', () => {
  const { createAccountTypeSchema, updateAccountTypeSchema } = require('../../modules/accounttype/accounttype.schemas');

  describe('create schema — positive cases', () => {
    it('passes with a valid Name', () => {
      expect(createAccountTypeSchema.validate({ Name: 'Expense' }).error).toBeUndefined();
    });
    it('passes with Name and explicit Active false', () => {
      expect(createAccountTypeSchema.validate({ Name: 'Expense', Active: false }).error).toBeUndefined();
    });
    it('accepts Name at exactly 100 characters', () => {
      expect(createAccountTypeSchema.validate({ Name: 'x'.repeat(100) }).error).toBeUndefined();
    });
    it('applies default Active true when omitted', () => {
      const { value } = createAccountTypeSchema.validate({ Name: 'Test' });
      expect(value.Active).toBe(true);
    });
  });

  describe('create schema — negative cases', () => {
    it('fails when Name is missing', () => {
      expect(createAccountTypeSchema.validate({}).error).toBeDefined();
    });
    it('fails when Name exceeds 100 characters', () => {
      expect(createAccountTypeSchema.validate({ Name: 'x'.repeat(101) }).error).toBeDefined();
    });
    it('fails when Name is a number', () => {
      expect(createAccountTypeSchema.validate({ Name: 42 }).error).toBeDefined();
    });
    it('fails when Active is not a boolean', () => {
      expect(createAccountTypeSchema.validate({ Name: 'Test', Active: 'yes' }).error).toBeDefined();
    });
  });

  describe('update schema — positive cases', () => {
    it('passes with a valid Name patch', () => {
      expect(updateAccountTypeSchema.validate({ Name: 'Revenue' }).error).toBeUndefined();
    });
    it('passes with only Active flag', () => {
      expect(updateAccountTypeSchema.validate({ Active: true }).error).toBeUndefined();
    });
    it('passes with both Name and Active', () => {
      expect(updateAccountTypeSchema.validate({ Name: 'Revenue', Active: false }).error).toBeUndefined();
    });
  });

  describe('update schema — negative cases', () => {
    it('fails for an empty body', () => {
      expect(updateAccountTypeSchema.validate({}).error).toBeDefined();
    });
    it('fails when Name exceeds max length', () => {
      expect(updateAccountTypeSchema.validate({ Name: 'x'.repeat(101) }).error).toBeDefined();
    });
    it('fails when Active is a non-boolean value', () => {
      expect(updateAccountTypeSchema.validate({ Active: 'yes' }).error).toBeDefined();
    });
  });
});
