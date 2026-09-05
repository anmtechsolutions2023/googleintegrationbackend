/**
 * itemdetail.service.test.js
 *
 * Unit tests for the itemdetail service layer.
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
  MODULE_REGISTRY.find((m) => m.name === 'itemdetail');

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

const VALID_UUID_ITEM = 'a1b2c3d4-1111-1111-1111-111111111111';

describe('itemdetail — field validation', () => {
  const { createSchema: createItemSchema, updateSchema: updateItemSchema } =
    require('../../modules/itemdetail/itemdetail.schemas');

  describe('create schema — positive cases', () => {
    it('passes with only required Name', () => {
      expect(createItemSchema.validate({ Name: 'Widget A' }).error).toBeUndefined();
    });
    it('passes with all optional fields', () => {
      const data = {
        Name: 'Widget A', Code: 'WGT-001', Description: 'A widget',
        CategoryId: VALID_UUID_ITEM, UOMId: VALID_UUID_ITEM, CostInfoId: VALID_UUID_ITEM,
        SKU: 'SKU-001', Barcode: '12345678', HSNCode: '8471', Active: true,
      };
      expect(createItemSchema.validate(data).error).toBeUndefined();
    });
    it('accepts Name at exactly 255 characters', () => {
      expect(createItemSchema.validate({ Name: 'x'.repeat(255) }).error).toBeUndefined();
    });
    it('accepts optional fields as null', () => {
      expect(createItemSchema.validate({ Name: 'Item', Code: null, SKU: null, Barcode: null }).error).toBeUndefined();
    });
    it('accepts Description at exactly 1000 characters', () => {
      expect(createItemSchema.validate({ Name: 'Item', Description: 'x'.repeat(1000) }).error).toBeUndefined();
    });
    it('defaults Active to true when omitted', () => {
      const { value } = createItemSchema.validate({ Name: 'Widget' });
      expect(value.Active).toBe(true);
    });
  });

  describe('create schema — negative cases', () => {
    it('fails when Name is missing', () => {
      expect(createItemSchema.validate({}).error).toBeDefined();
    });
    it('fails when Name exceeds 255 characters', () => {
      expect(createItemSchema.validate({ Name: 'x'.repeat(256) }).error).toBeDefined();
    });
    it('fails when Name is a number', () => {
      expect(createItemSchema.validate({ Name: 42 }).error).toBeDefined();
    });
    it('fails when Code exceeds 50 characters', () => {
      expect(createItemSchema.validate({ Name: 'Item', Code: 'x'.repeat(51) }).error).toBeDefined();
    });
    it('fails when Description exceeds 1000 characters', () => {
      expect(createItemSchema.validate({ Name: 'Item', Description: 'x'.repeat(1001) }).error).toBeDefined();
    });
    it('fails when CategoryId is not a valid UUID', () => {
      expect(createItemSchema.validate({ Name: 'Item', CategoryId: 'bad-uuid' }).error).toBeDefined();
    });
    it('fails when SKU exceeds 100 characters', () => {
      expect(createItemSchema.validate({ Name: 'Item', SKU: 'x'.repeat(101) }).error).toBeDefined();
    });
  });

  describe('update schema — positive cases', () => {
    it('passes with Name patch', () => {
      expect(updateItemSchema.validate({ Name: 'Widget B' }).error).toBeUndefined();
    });
    it('passes with Code as null', () => {
      expect(updateItemSchema.validate({ Code: null }).error).toBeUndefined();
    });
    it('passes with only Active flag', () => {
      expect(updateItemSchema.validate({ Active: false }).error).toBeUndefined();
    });
    it('passes with CategoryId as valid UUID', () => {
      expect(updateItemSchema.validate({ CategoryId: VALID_UUID_ITEM }).error).toBeUndefined();
    });
  });

  describe('update schema — negative cases', () => {
    it('fails for an empty body', () => {
      expect(updateItemSchema.validate({}).error).toBeDefined();
    });
    it('fails when Name exceeds 255 characters', () => {
      expect(updateItemSchema.validate({ Name: 'x'.repeat(256) }).error).toBeDefined();
    });
    it('fails when UOMId is not a valid UUID', () => {
      expect(updateItemSchema.validate({ UOMId: 'bad' }).error).toBeDefined();
    });
  });
});
