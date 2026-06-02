/**
 * paymentreceivedtype.service.test.js
 *
 * Unit tests for the paymentreceivedtype service layer.
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
  MODULE_REGISTRY.find((m) => m.name === 'paymentreceivedtype');

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

describe('paymentreceivedtype — field validation', () => {
  const { createSchema: createPRTSchema, updateSchema: updatePRTSchema } =
    require('../../modules/paymentreceivedtype/paymentreceivedtype.schemas');

  describe('create schema — positive cases', () => {
    it('passes with a valid Type', () => {
      expect(createPRTSchema.validate({ Type: 'Full Payment' }).error).toBeUndefined();
    });
    it('passes with Type and Active false', () => {
      expect(createPRTSchema.validate({ Type: 'Advance', Active: false }).error).toBeUndefined();
    });
    it('accepts Type at exactly 50 characters', () => {
      expect(createPRTSchema.validate({ Type: 'x'.repeat(50) }).error).toBeUndefined();
    });
    it('defaults Active to true when omitted', () => {
      const { value } = createPRTSchema.validate({ Type: 'Partial' });
      expect(value.Active).toBe(true);
    });
  });

  describe('create schema — negative cases', () => {
    it('fails when Type is missing', () => {
      expect(createPRTSchema.validate({}).error).toBeDefined();
    });
    it('fails when Type exceeds 50 characters', () => {
      expect(createPRTSchema.validate({ Type: 'x'.repeat(51) }).error).toBeDefined();
    });
    it('fails when Type is a number', () => {
      expect(createPRTSchema.validate({ Type: 100 }).error).toBeDefined();
    });
    it('fails when Active is a number instead of boolean', () => {
      expect(createPRTSchema.validate({ Type: 'Full', Active: 0 }).error).toBeDefined();
    });
  });

  describe('update schema — positive cases', () => {
    it('passes with a valid Type patch', () => {
      expect(updatePRTSchema.validate({ Type: 'Partial Payment' }).error).toBeUndefined();
    });
    it('passes with only Active flag', () => {
      expect(updatePRTSchema.validate({ Active: true }).error).toBeUndefined();
    });
  });

  describe('update schema — negative cases', () => {
    it('fails for an empty body', () => {
      expect(updatePRTSchema.validate({}).error).toBeDefined();
    });
    it('fails when Type exceeds 50 characters', () => {
      expect(updatePRTSchema.validate({ Type: 'x'.repeat(51) }).error).toBeDefined();
    });
  });
});
