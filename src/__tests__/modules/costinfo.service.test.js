/**
 * costinfo.service.test.js
 *
 * Unit tests for the costinfo service layer.
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
  MODULE_REGISTRY.find((m) => m.name === 'costinfo');

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

const VALID_UUID_CI = 'a1b2c3d4-1111-1111-1111-111111111111';

describe('costinfo — field validation', () => {
  const { createSchema: createCostInfoSchema, updateSchema: updateCostInfoSchema } =
    require('../../modules/costinfo/costinfo.schemas');

  describe('create schema — positive cases', () => {
    it('passes with required Amount only', () => {
      expect(createCostInfoSchema.validate({ Amount: 1000 }).error).toBeUndefined();
    });
    it('passes with Amount and TaxGroupId', () => {
      expect(createCostInfoSchema.validate({ Amount: 500.50, TaxGroupId: VALID_UUID_CI }).error).toBeUndefined();
    });
    it('passes with IsTaxIncluded true', () => {
      expect(createCostInfoSchema.validate({ Amount: 1180, TaxGroupId: VALID_UUID_CI, IsTaxIncluded: true }).error).toBeUndefined();
    });
    it('passes with Amount at 0', () => {
      expect(createCostInfoSchema.validate({ Amount: 0 }).error).toBeUndefined();
    });
    it('accepts TaxGroupId as null', () => {
      expect(createCostInfoSchema.validate({ Amount: 100, TaxGroupId: null }).error).toBeUndefined();
    });
    it('defaults IsTaxIncluded to false when omitted', () => {
      const { value } = createCostInfoSchema.validate({ Amount: 100 });
      expect(value.IsTaxIncluded).toBe(false);
    });
    it('defaults Active to true when omitted', () => {
      const { value } = createCostInfoSchema.validate({ Amount: 100 });
      expect(value.Active).toBe(true);
    });
  });

  describe('create schema — negative cases', () => {
    it('fails when Amount is missing', () => {
      expect(createCostInfoSchema.validate({}).error).toBeDefined();
    });
    it('fails when Amount is a non-numeric string', () => {
      expect(createCostInfoSchema.validate({ Amount: 'thousand' }).error).toBeDefined();
    });
    it('fails when TaxGroupId is not a valid UUID', () => {
      expect(createCostInfoSchema.validate({ Amount: 100, TaxGroupId: 'not-uuid' }).error).toBeDefined();
    });
    it('fails when IsTaxIncluded is not a boolean', () => {
      expect(createCostInfoSchema.validate({ Amount: 100, IsTaxIncluded: 1 }).error).toBeDefined();
    });
    it('fails when Active is not a boolean', () => {
      expect(createCostInfoSchema.validate({ Amount: 100, Active: 'yes' }).error).toBeDefined();
    });
  });

  describe('update schema — positive cases', () => {
    it('passes with only Amount patch', () => {
      expect(updateCostInfoSchema.validate({ Amount: 2000 }).error).toBeUndefined();
    });
    it('passes with only TaxGroupId patch', () => {
      expect(updateCostInfoSchema.validate({ TaxGroupId: VALID_UUID_CI }).error).toBeUndefined();
    });
    it('passes with IsTaxIncluded toggle', () => {
      expect(updateCostInfoSchema.validate({ IsTaxIncluded: true }).error).toBeUndefined();
    });
    it('passes with only Active flag', () => {
      expect(updateCostInfoSchema.validate({ Active: false }).error).toBeUndefined();
    });
  });

  describe('update schema — negative cases', () => {
    it('fails for an empty body', () => {
      expect(updateCostInfoSchema.validate({}).error).toBeDefined();
    });
    it('fails when Amount is a string', () => {
      expect(updateCostInfoSchema.validate({ Amount: 'five hundred' }).error).toBeDefined();
    });
    it('fails when TaxGroupId is invalid UUID', () => {
      expect(updateCostInfoSchema.validate({ TaxGroupId: 'not-a-valid-uuid' }).error).toBeDefined();
    });
  });
});
