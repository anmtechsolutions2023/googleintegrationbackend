/**
 * uom.service.test.js
 *
 * Unit tests for the uom service layer.
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
  MODULE_REGISTRY.find((m) => m.name === 'uom');

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

describe('uom — field validation', () => {
  const { createUomSchema, updateUomSchema } =
    require('../../modules/uom/uom.schemas');

  describe('create schema — positive cases', () => {
    it('passes with a valid UnitName', () => {
      expect(createUomSchema.validate({ UnitName: 'KG' }).error).toBeUndefined();
    });
    it('passes with UnitName and IsPrimary true', () => {
      expect(createUomSchema.validate({ UnitName: 'KG', IsPrimary: true }).error).toBeUndefined();
    });
    it('passes with all fields provided', () => {
      expect(createUomSchema.validate({ UnitName: 'LB', IsPrimary: false, Active: true }).error).toBeUndefined();
    });
    it('accepts UnitName at exactly 100 characters', () => {
      expect(createUomSchema.validate({ UnitName: 'x'.repeat(100) }).error).toBeUndefined();
    });
    it('defaults IsPrimary to false when omitted', () => {
      const { value } = createUomSchema.validate({ UnitName: 'KG' });
      expect(value.IsPrimary).toBe(false);
    });
    it('defaults Active to true when omitted', () => {
      const { value } = createUomSchema.validate({ UnitName: 'KG' });
      expect(value.Active).toBe(true);
    });
  });

  describe('create schema — negative cases', () => {
    it('fails when UnitName is missing', () => {
      expect(createUomSchema.validate({}).error).toBeDefined();
    });
    it('fails when UnitName exceeds 100 characters', () => {
      expect(createUomSchema.validate({ UnitName: 'x'.repeat(101) }).error).toBeDefined();
    });
    it('fails when UnitName is a number', () => {
      expect(createUomSchema.validate({ UnitName: 100 }).error).toBeDefined();
    });
    it('fails when IsPrimary is a string', () => {
      expect(createUomSchema.validate({ UnitName: 'KG', IsPrimary: 'yes' }).error).toBeDefined();
    });
    it('fails when Active is not a boolean', () => {
      expect(createUomSchema.validate({ UnitName: 'KG', Active: 1 }).error).toBeDefined();
    });
  });

  describe('update schema — positive cases', () => {
    it('passes with UnitName patch', () => {
      expect(updateUomSchema.validate({ UnitName: 'LB' }).error).toBeUndefined();
    });
    it('passes with IsPrimary toggle', () => {
      expect(updateUomSchema.validate({ IsPrimary: true }).error).toBeUndefined();
    });
    it('passes with Active flag', () => {
      expect(updateUomSchema.validate({ Active: false }).error).toBeUndefined();
    });
  });

  describe('update schema — negative cases', () => {
    it('fails for an empty body', () => {
      expect(updateUomSchema.validate({}).error).toBeDefined();
    });
    it('fails when UnitName exceeds 100 characters', () => {
      expect(updateUomSchema.validate({ UnitName: 'x'.repeat(101) }).error).toBeDefined();
    });
    it('fails when IsPrimary is a non-coercible string', () => {
      expect(updateUomSchema.validate({ IsPrimary: 'yes' }).error).toBeDefined();
    });
  });
});
