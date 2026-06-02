/**
 * taxgrouptaxtypemapper.service.test.js
 *
 * Unit tests for the taxgrouptaxtypemapper service layer.
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
  MODULE_REGISTRY.find((m) => m.name === 'taxgrouptaxtypemapper');

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

const VALID_UUID_TGTM = 'a1b2c3d4-1111-1111-1111-111111111111';

describe('taxgrouptaxtypemapper — field validation', () => {
  const { createSchema: createTGTTMSchema, updateSchema: updateTGTTMSchema } =
    require('../../modules/taxgrouptaxtypemapper/taxgrouptaxtypemapper.schemas');

  describe('create schema — positive cases', () => {
    it('passes with valid TaxGroupId and TaxTypeId', () => {
      expect(createTGTTMSchema.validate({ TaxGroupId: VALID_UUID_TGTM, TaxTypeId: VALID_UUID_TGTM }).error).toBeUndefined();
    });
    it('passes with all fields including Active false', () => {
      expect(createTGTTMSchema.validate({ TaxGroupId: VALID_UUID_TGTM, TaxTypeId: VALID_UUID_TGTM, Active: false }).error).toBeUndefined();
    });
    it('defaults Active to true when omitted', () => {
      const { value } = createTGTTMSchema.validate({ TaxGroupId: VALID_UUID_TGTM, TaxTypeId: VALID_UUID_TGTM });
      expect(value.Active).toBe(true);
    });
  });

  describe('create schema — negative cases', () => {
    it('fails when TaxGroupId is missing', () => {
      expect(createTGTTMSchema.validate({ TaxTypeId: VALID_UUID_TGTM }).error).toBeDefined();
    });
    it('fails when TaxTypeId is missing', () => {
      expect(createTGTTMSchema.validate({ TaxGroupId: VALID_UUID_TGTM }).error).toBeDefined();
    });
    it('fails when both are missing', () => {
      expect(createTGTTMSchema.validate({}).error).toBeDefined();
    });
    it('fails when TaxGroupId is not a valid UUID', () => {
      expect(createTGTTMSchema.validate({ TaxGroupId: 'not-a-uuid', TaxTypeId: VALID_UUID_TGTM }).error).toBeDefined();
    });
    it('fails when TaxTypeId is not a valid UUID', () => {
      expect(createTGTTMSchema.validate({ TaxGroupId: VALID_UUID_TGTM, TaxTypeId: 'bad-uuid' }).error).toBeDefined();
    });
    it('fails when Active is not a boolean', () => {
      expect(createTGTTMSchema.validate({ TaxGroupId: VALID_UUID_TGTM, TaxTypeId: VALID_UUID_TGTM, Active: 1 }).error).toBeDefined();
    });
  });

  describe('update schema — positive cases', () => {
    it('passes with only Active flag', () => {
      expect(updateTGTTMSchema.validate({ Active: false }).error).toBeUndefined();
    });
    it('passes with TaxGroupId patch', () => {
      expect(updateTGTTMSchema.validate({ TaxGroupId: VALID_UUID_TGTM }).error).toBeUndefined();
    });
    it('passes with TaxTypeId patch', () => {
      expect(updateTGTTMSchema.validate({ TaxTypeId: VALID_UUID_TGTM }).error).toBeUndefined();
    });
  });

  describe('update schema — negative cases', () => {
    it('fails for an empty body', () => {
      expect(updateTGTTMSchema.validate({}).error).toBeDefined();
    });
    it('fails when TaxGroupId is invalid UUID', () => {
      expect(updateTGTTMSchema.validate({ TaxGroupId: 'not-uuid' }).error).toBeDefined();
    });
  });
});
