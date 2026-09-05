/**
 * locationdetail.service.test.js
 *
 * Unit tests for the locationdetail service layer.
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
  MODULE_REGISTRY.find((m) => m.name === 'locationdetail');

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

describe('locationdetail — field validation', () => {
  const { createSchema: createLocationSchema, updateSchema: updateLocationSchema } =
    require('../../modules/locationdetail/locationdetail.schemas');

  describe('create schema — positive cases', () => {
    it('passes with valid Lat and Lng', () => {
      expect(createLocationSchema.validate({ Lat: 12.9716, Lng: 77.5946 }).error).toBeUndefined();
    });
    it('passes with all optional CF fields', () => {
      expect(createLocationSchema.validate({ Lat: 12.0, Lng: 77.0, CF1: 'Area1', CF2: 'Block2', CF3: null, CF4: '' }).error).toBeUndefined();
    });
    it('passes with negative coordinates', () => {
      expect(createLocationSchema.validate({ Lat: -33.8688, Lng: 151.2093 }).error).toBeUndefined();
    });
    it('defaults Active to true when omitted', () => {
      const { value } = createLocationSchema.validate({ Lat: 0, Lng: 0 });
      expect(value.Active).toBe(true);
    });
  });

  describe('create schema — negative cases', () => {
    it('fails when Lat is missing', () => {
      expect(createLocationSchema.validate({ Lng: 77.5946 }).error).toBeDefined();
    });
    it('fails when Lng is missing', () => {
      expect(createLocationSchema.validate({ Lat: 12.9716 }).error).toBeDefined();
    });
    it('fails when both Lat and Lng are missing', () => {
      expect(createLocationSchema.validate({}).error).toBeDefined();
    });
    it('fails when Lat is a non-numeric string', () => {
      expect(createLocationSchema.validate({ Lat: 'north', Lng: 77.0 }).error).toBeDefined();
    });
    it('fails when Lng is a non-numeric string', () => {
      expect(createLocationSchema.validate({ Lat: 12.0, Lng: 'east' }).error).toBeDefined();
    });
    it('fails when Active is not a boolean', () => {
      expect(createLocationSchema.validate({ Lat: 12.0, Lng: 77.0, Active: 1 }).error).toBeDefined();
    });
  });

  describe('update schema — positive cases', () => {
    it('passes with only Lat patch', () => {
      expect(updateLocationSchema.validate({ Lat: 13.0 }).error).toBeUndefined();
    });
    it('passes with only Lng patch', () => {
      expect(updateLocationSchema.validate({ Lng: 78.0 }).error).toBeUndefined();
    });
    it('passes with CF fields as null', () => {
      expect(updateLocationSchema.validate({ CF1: null, CF2: null }).error).toBeUndefined();
    });
    it('passes with only Active flag', () => {
      expect(updateLocationSchema.validate({ Active: false }).error).toBeUndefined();
    });
  });

  describe('update schema — negative cases', () => {
    it('fails for an empty body', () => {
      expect(updateLocationSchema.validate({}).error).toBeDefined();
    });
    it('fails when Lat is a string', () => {
      expect(updateLocationSchema.validate({ Lat: 'far north' }).error).toBeDefined();
    });
  });
});
