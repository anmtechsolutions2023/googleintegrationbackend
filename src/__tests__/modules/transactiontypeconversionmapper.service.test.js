/**
 * transactiontypeconversionmapper.service.test.js
 *
 * Unit tests for the transactiontypeconversionmapper service layer.
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
  MODULE_REGISTRY.find((m) => m.name === 'transactiontypeconversionmapper');

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

const VALID_UUID_TTCM = 'a1b2c3d4-1111-1111-1111-111111111111';

describe('transactiontypeconversionmapper — field validation', () => {
  const { createSchema: createTTCMSchema, updateSchema: updateTTCMSchema } =
    require('../../modules/transactiontypeconversionmapper/transactiontypeconversionmapper.schemas');

  describe('create schema — positive cases', () => {
    it('passes with all three required UUID fields', () => {
      const data = {
        TransactionTypeBaseCoversionId: VALID_UUID_TTCM,
        TransactionDetailLogId: VALID_UUID_TTCM,
        TransactionTypeStatusId: VALID_UUID_TTCM,
      };
      expect(createTTCMSchema.validate(data).error).toBeUndefined();
    });
    it('passes with Active false', () => {
      const data = {
        TransactionTypeBaseCoversionId: VALID_UUID_TTCM,
        TransactionDetailLogId: VALID_UUID_TTCM,
        TransactionTypeStatusId: VALID_UUID_TTCM,
        Active: false,
      };
      expect(createTTCMSchema.validate(data).error).toBeUndefined();
    });
    it('defaults Active to true when omitted', () => {
      const { value } = createTTCMSchema.validate({
        TransactionTypeBaseCoversionId: VALID_UUID_TTCM,
        TransactionDetailLogId: VALID_UUID_TTCM,
        TransactionTypeStatusId: VALID_UUID_TTCM,
      });
      expect(value.Active).toBe(true);
    });
  });

  describe('create schema — negative cases', () => {
    it('fails when TransactionTypeBaseCoversionId is missing', () => {
      expect(createTTCMSchema.validate({ TransactionDetailLogId: VALID_UUID_TTCM, TransactionTypeStatusId: VALID_UUID_TTCM }).error).toBeDefined();
    });
    it('fails when TransactionDetailLogId is missing', () => {
      expect(createTTCMSchema.validate({ TransactionTypeBaseCoversionId: VALID_UUID_TTCM, TransactionTypeStatusId: VALID_UUID_TTCM }).error).toBeDefined();
    });
    it('fails when TransactionTypeStatusId is missing', () => {
      expect(createTTCMSchema.validate({ TransactionTypeBaseCoversionId: VALID_UUID_TTCM, TransactionDetailLogId: VALID_UUID_TTCM }).error).toBeDefined();
    });
    it('fails when all fields are missing', () => {
      expect(createTTCMSchema.validate({}).error).toBeDefined();
    });
    it('fails when TransactionTypeBaseCoversionId is not a valid UUID', () => {
      expect(createTTCMSchema.validate({ TransactionTypeBaseCoversionId: 'bad', TransactionDetailLogId: VALID_UUID_TTCM, TransactionTypeStatusId: VALID_UUID_TTCM }).error).toBeDefined();
    });
    it('fails when TransactionDetailLogId is not a valid UUID', () => {
      expect(createTTCMSchema.validate({ TransactionTypeBaseCoversionId: VALID_UUID_TTCM, TransactionDetailLogId: 'not-uuid', TransactionTypeStatusId: VALID_UUID_TTCM }).error).toBeDefined();
    });
    it('fails when Active is not a boolean', () => {
      expect(createTTCMSchema.validate({ TransactionTypeBaseCoversionId: VALID_UUID_TTCM, TransactionDetailLogId: VALID_UUID_TTCM, TransactionTypeStatusId: VALID_UUID_TTCM, Active: 1 }).error).toBeDefined();
    });
  });

  describe('update schema — positive cases', () => {
    it('passes with only Active flag', () => {
      expect(updateTTCMSchema.validate({ Active: false }).error).toBeUndefined();
    });
    it('passes with TransactionTypeStatusId patch', () => {
      expect(updateTTCMSchema.validate({ TransactionTypeStatusId: VALID_UUID_TTCM }).error).toBeUndefined();
    });
    it('passes with TransactionDetailLogId patch', () => {
      expect(updateTTCMSchema.validate({ TransactionDetailLogId: VALID_UUID_TTCM }).error).toBeUndefined();
    });
  });

  describe('update schema — negative cases', () => {
    it('fails for an empty body', () => {
      expect(updateTTCMSchema.validate({}).error).toBeDefined();
    });
    it('fails when TransactionTypeBaseCoversionId is invalid UUID', () => {
      expect(updateTTCMSchema.validate({ TransactionTypeBaseCoversionId: 'not-uuid' }).error).toBeDefined();
    });
    it('fails when TransactionTypeStatusId is invalid UUID', () => {
      expect(updateTTCMSchema.validate({ TransactionTypeStatusId: 'bad-id' }).error).toBeDefined();
    });
  });
});
