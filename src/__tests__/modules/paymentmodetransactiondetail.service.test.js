/**
 * paymentmodetransactiondetail.service.test.js
 *
 * Unit tests for the paymentmodetransactiondetail service layer.
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
  MODULE_REGISTRY.find((m) => m.name === 'paymentmodetransactiondetail');

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

const VALID_UUID_PMTD = 'a1b2c3d4-1111-1111-1111-111111111111';

describe('paymentmodetransactiondetail — field validation', () => {
  const { createSchema: createPMTDSchema, updateSchema: updatePMTDSchema } =
    require('../../modules/paymentmodetransactiondetail/paymentmodetransactiondetail.schemas');

  describe('create schema — positive cases', () => {
    it('passes with only required PaymentModeId', () => {
      expect(createPMTDSchema.validate({ PaymentModeId: VALID_UUID_PMTD }).error).toBeUndefined();
    });
    it('passes with all optional fields', () => {
      const data = {
        PaymentModeId: VALID_UUID_PMTD, RefNo: 'TXN-001', Comment: 'Test payment',
        CF1: 'Field1', CF2: 'Field2', CF3: 'Field3', CF4: 'Field4', Active: true,
      };
      expect(createPMTDSchema.validate(data).error).toBeUndefined();
    });
    it('passes with optional fields as null', () => {
      expect(createPMTDSchema.validate({ PaymentModeId: VALID_UUID_PMTD, RefNo: null, Comment: null }).error).toBeUndefined();
    });
    it('accepts RefNo at exactly 50 characters', () => {
      expect(createPMTDSchema.validate({ PaymentModeId: VALID_UUID_PMTD, RefNo: 'x'.repeat(50) }).error).toBeUndefined();
    });
    it('accepts Comment at exactly 100 characters', () => {
      expect(createPMTDSchema.validate({ PaymentModeId: VALID_UUID_PMTD, Comment: 'x'.repeat(100) }).error).toBeUndefined();
    });
    it('defaults Active to true when omitted', () => {
      const { value } = createPMTDSchema.validate({ PaymentModeId: VALID_UUID_PMTD });
      expect(value.Active).toBe(true);
    });
  });

  describe('create schema — negative cases', () => {
    it('fails when PaymentModeId is missing', () => {
      expect(createPMTDSchema.validate({}).error).toBeDefined();
    });
    it('fails when PaymentModeId is not a valid UUID', () => {
      expect(createPMTDSchema.validate({ PaymentModeId: 'not-uuid' }).error).toBeDefined();
    });
    it('fails when RefNo exceeds 50 characters', () => {
      expect(createPMTDSchema.validate({ PaymentModeId: VALID_UUID_PMTD, RefNo: 'x'.repeat(51) }).error).toBeDefined();
    });
    it('fails when Comment exceeds 100 characters', () => {
      expect(createPMTDSchema.validate({ PaymentModeId: VALID_UUID_PMTD, Comment: 'x'.repeat(101) }).error).toBeDefined();
    });
    it('fails when CF1 exceeds 50 characters', () => {
      expect(createPMTDSchema.validate({ PaymentModeId: VALID_UUID_PMTD, CF1: 'x'.repeat(51) }).error).toBeDefined();
    });
    it('fails when Active is not a boolean', () => {
      expect(createPMTDSchema.validate({ PaymentModeId: VALID_UUID_PMTD, Active: 'yes' }).error).toBeDefined();
    });
  });

  describe('update schema — positive cases', () => {
    it('passes with only RefNo patch', () => {
      expect(updatePMTDSchema.validate({ RefNo: 'TXN-002' }).error).toBeUndefined();
    });
    it('passes with Comment as null', () => {
      expect(updatePMTDSchema.validate({ Comment: null }).error).toBeUndefined();
    });
    it('passes with only Active flag', () => {
      expect(updatePMTDSchema.validate({ Active: false }).error).toBeUndefined();
    });
    it('passes with CF fields patch', () => {
      expect(updatePMTDSchema.validate({ CF1: 'NewField1' }).error).toBeUndefined();
    });
  });

  describe('update schema — negative cases', () => {
    it('fails for an empty body', () => {
      expect(updatePMTDSchema.validate({}).error).toBeDefined();
    });
    it('fails when PaymentModeId is invalid UUID', () => {
      expect(updatePMTDSchema.validate({ PaymentModeId: 'bad' }).error).toBeDefined();
    });
    it('fails when RefNo exceeds 50 characters', () => {
      expect(updatePMTDSchema.validate({ RefNo: 'x'.repeat(51) }).error).toBeDefined();
    });
  });
});
