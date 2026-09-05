/**
 * transactionitemdetail.service.test.js
 *
 * Unit tests for the transactionitemdetail service layer.
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
  MODULE_REGISTRY.find((m) => m.name === 'transactionitemdetail');

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

const VALID_UUID_TID = 'a1b2c3d4-1111-1111-1111-111111111111';

describe('transactionitemdetail — field validation', () => {
  const { createSchema: createTIDSchema, updateSchema: updateTIDSchema } =
    require('../../modules/transactionitemdetail/transactionitemdetail.schemas');

  describe('create schema — positive cases', () => {
    it('passes with required TransactionDetailLogId and ItemId', () => {
      expect(createTIDSchema.validate({ TransactionDetailLogId: VALID_UUID_TID, ItemId: VALID_UUID_TID }).error).toBeUndefined();
    });
    it('passes with optional Comment', () => {
      expect(createTIDSchema.validate({ TransactionDetailLogId: VALID_UUID_TID, ItemId: VALID_UUID_TID, Comment: 'Item note' }).error).toBeUndefined();
    });
    it('passes with Comment as null', () => {
      expect(createTIDSchema.validate({ TransactionDetailLogId: VALID_UUID_TID, ItemId: VALID_UUID_TID, Comment: null }).error).toBeUndefined();
    });
    it('accepts Comment at exactly 100 characters', () => {
      expect(createTIDSchema.validate({ TransactionDetailLogId: VALID_UUID_TID, ItemId: VALID_UUID_TID, Comment: 'x'.repeat(100) }).error).toBeUndefined();
    });
    it('defaults Active to true when omitted', () => {
      const { value } = createTIDSchema.validate({ TransactionDetailLogId: VALID_UUID_TID, ItemId: VALID_UUID_TID });
      expect(value.Active).toBe(true);
    });
  });

  describe('create schema — negative cases', () => {
    it('fails when TransactionDetailLogId is missing', () => {
      expect(createTIDSchema.validate({ ItemId: VALID_UUID_TID }).error).toBeDefined();
    });
    it('fails when ItemId is missing', () => {
      expect(createTIDSchema.validate({ TransactionDetailLogId: VALID_UUID_TID }).error).toBeDefined();
    });
    it('fails when both fields are missing', () => {
      expect(createTIDSchema.validate({}).error).toBeDefined();
    });
    it('fails when TransactionDetailLogId is not a valid UUID', () => {
      expect(createTIDSchema.validate({ TransactionDetailLogId: 'not-uuid', ItemId: VALID_UUID_TID }).error).toBeDefined();
    });
    it('fails when ItemId is not a valid UUID', () => {
      expect(createTIDSchema.validate({ TransactionDetailLogId: VALID_UUID_TID, ItemId: 'bad' }).error).toBeDefined();
    });
    it('fails when Comment exceeds 100 characters', () => {
      expect(createTIDSchema.validate({ TransactionDetailLogId: VALID_UUID_TID, ItemId: VALID_UUID_TID, Comment: 'x'.repeat(101) }).error).toBeDefined();
    });
  });

  describe('update schema — positive cases', () => {
    it('passes with only Comment patch', () => {
      expect(updateTIDSchema.validate({ Comment: 'Updated note' }).error).toBeUndefined();
    });
    it('passes with Comment as null', () => {
      expect(updateTIDSchema.validate({ Comment: null }).error).toBeUndefined();
    });
    it('passes with only Active flag', () => {
      expect(updateTIDSchema.validate({ Active: false }).error).toBeUndefined();
    });
    it('passes with ItemId patch', () => {
      expect(updateTIDSchema.validate({ ItemId: VALID_UUID_TID }).error).toBeUndefined();
    });
  });

  describe('update schema — negative cases', () => {
    it('fails for an empty body', () => {
      expect(updateTIDSchema.validate({}).error).toBeDefined();
    });
    it('fails when ItemId is not a valid UUID', () => {
      expect(updateTIDSchema.validate({ ItemId: 'bad-uuid' }).error).toBeDefined();
    });
    it('fails when Comment exceeds 100 characters', () => {
      expect(updateTIDSchema.validate({ Comment: 'x'.repeat(101) }).error).toBeDefined();
    });
  });
});
