/**
 * uomfactor.service.test.js
 *
 * Unit tests for the uomfactor service layer.
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
  MODULE_REGISTRY.find((m) => m.name === 'uomfactor');

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

const VALID_UUID_UF = 'a1b2c3d4-1111-1111-1111-111111111111';

describe('uomfactor — field validation', () => {
  const { createUomFactorSchema, updateUomFactorSchema } =
    require('../../modules/uomfactor/uomfactor.schemas');

  describe('create schema — positive cases', () => {
    it('passes with all required fields', () => {
      expect(createUomFactorSchema.validate({ PrimaryUOMId: VALID_UUID_UF, SecondaryUOMId: VALID_UUID_UF, Factor: 1000 }).error).toBeUndefined();
    });
    it('passes with Factor at 0', () => {
      expect(createUomFactorSchema.validate({ PrimaryUOMId: VALID_UUID_UF, SecondaryUOMId: VALID_UUID_UF, Factor: 0 }).error).toBeUndefined();
    });
    it('passes with decimal Factor', () => {
      expect(createUomFactorSchema.validate({ PrimaryUOMId: VALID_UUID_UF, SecondaryUOMId: VALID_UUID_UF, Factor: 0.001234 }).error).toBeUndefined();
    });
    it('defaults Active to true when omitted', () => {
      const { value } = createUomFactorSchema.validate({ PrimaryUOMId: VALID_UUID_UF, SecondaryUOMId: VALID_UUID_UF, Factor: 500 });
      expect(value.Active).toBe(true);
    });
  });

  describe('create schema — negative cases', () => {
    it('fails when PrimaryUOMId is missing', () => {
      expect(createUomFactorSchema.validate({ SecondaryUOMId: VALID_UUID_UF, Factor: 1000 }).error).toBeDefined();
    });
    it('fails when SecondaryUOMId is missing', () => {
      expect(createUomFactorSchema.validate({ PrimaryUOMId: VALID_UUID_UF, Factor: 1000 }).error).toBeDefined();
    });
    it('fails when Factor is missing', () => {
      expect(createUomFactorSchema.validate({ PrimaryUOMId: VALID_UUID_UF, SecondaryUOMId: VALID_UUID_UF }).error).toBeDefined();
    });
    it('fails when PrimaryUOMId is not a valid UUID', () => {
      expect(createUomFactorSchema.validate({ PrimaryUOMId: 'not-uuid', SecondaryUOMId: VALID_UUID_UF, Factor: 1000 }).error).toBeDefined();
    });
    it('fails when Factor is negative', () => {
      expect(createUomFactorSchema.validate({ PrimaryUOMId: VALID_UUID_UF, SecondaryUOMId: VALID_UUID_UF, Factor: -1 }).error).toBeDefined();
    });
    it('fails when Factor is a string', () => {
      expect(createUomFactorSchema.validate({ PrimaryUOMId: VALID_UUID_UF, SecondaryUOMId: VALID_UUID_UF, Factor: 'thousand' }).error).toBeDefined();
    });
  });

  describe('update schema — positive cases', () => {
    it('passes with only Factor patch', () => {
      expect(updateUomFactorSchema.validate({ Factor: 500 }).error).toBeUndefined();
    });
    it('passes with only Active flag', () => {
      expect(updateUomFactorSchema.validate({ Active: false }).error).toBeUndefined();
    });
    it('passes with PrimaryUOMId patch', () => {
      expect(updateUomFactorSchema.validate({ PrimaryUOMId: VALID_UUID_UF }).error).toBeUndefined();
    });
  });

  describe('update schema — negative cases', () => {
    it('fails for an empty body', () => {
      expect(updateUomFactorSchema.validate({}).error).toBeDefined();
    });
    it('fails when Factor is negative', () => {
      expect(updateUomFactorSchema.validate({ Factor: -10 }).error).toBeDefined();
    });
    it('fails when SecondaryUOMId is invalid UUID', () => {
      expect(updateUomFactorSchema.validate({ SecondaryUOMId: 'bad' }).error).toBeDefined();
    });
  });
});
