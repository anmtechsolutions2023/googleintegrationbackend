/**
 * paymentdetail.service.test.js
 *
 * Unit tests for the paymentdetail service layer.
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
  MODULE_REGISTRY.find((m) => m.name === 'paymentdetail');

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

const VALID_UUID_PD = 'a1b2c3d4-1111-1111-1111-111111111111';

describe('paymentdetail — field validation', () => {
  const { createSchema: createPayDetailSchema, updateSchema: updatePayDetailSchema } =
    require('../../modules/paymentdetail/paymentdetail.schemas');

  describe('create schema — positive cases', () => {
    it('passes with all four required fields', () => {
      const data = {
        AccountTypeBaseId: VALID_UUID_PD, TransactionDetailLogId: VALID_UUID_PD,
        TotalAmount: '1130.50', GrossAmount: '1000.00',
      };
      expect(createPayDetailSchema.validate(data).error).toBeUndefined();
    });
    it('passes with all optional fields', () => {
      const data = {
        AccountTypeBaseId: VALID_UUID_PD, TransactionDetailLogId: VALID_UUID_PD,
        TotalAmount: '1130.50', GrossAmount: '1000.00',
        TaxesAmount: '180.00', DiscountAmount: '50.00', RoundOff: '0.50',
        UserId: VALID_UUID_PD, Active: true,
      };
      expect(createPayDetailSchema.validate(data).error).toBeUndefined();
    });
    it('passes with optional fields as null', () => {
      const data = {
        AccountTypeBaseId: VALID_UUID_PD, TransactionDetailLogId: VALID_UUID_PD,
        TotalAmount: '1000', GrossAmount: '1000', TaxesAmount: null, UserId: null,
      };
      expect(createPayDetailSchema.validate(data).error).toBeUndefined();
    });
    it('accepts TotalAmount at exactly 50 characters', () => {
      const data = { AccountTypeBaseId: VALID_UUID_PD, TransactionDetailLogId: VALID_UUID_PD, TotalAmount: '1'.repeat(50), GrossAmount: '1000' };
      expect(createPayDetailSchema.validate(data).error).toBeUndefined();
    });
    it('defaults Active to true when omitted', () => {
      const { value } = createPayDetailSchema.validate({
        AccountTypeBaseId: VALID_UUID_PD, TransactionDetailLogId: VALID_UUID_PD,
        TotalAmount: '1000', GrossAmount: '1000',
      });
      expect(value.Active).toBe(true);
    });
  });

  describe('create schema — negative cases', () => {
    it('fails when AccountTypeBaseId is missing', () => {
      expect(createPayDetailSchema.validate({ TransactionDetailLogId: VALID_UUID_PD, TotalAmount: '1000', GrossAmount: '1000' }).error).toBeDefined();
    });
    it('fails when TransactionDetailLogId is missing', () => {
      expect(createPayDetailSchema.validate({ AccountTypeBaseId: VALID_UUID_PD, TotalAmount: '1000', GrossAmount: '1000' }).error).toBeDefined();
    });
    it('fails when TotalAmount is missing', () => {
      expect(createPayDetailSchema.validate({ AccountTypeBaseId: VALID_UUID_PD, TransactionDetailLogId: VALID_UUID_PD, GrossAmount: '1000' }).error).toBeDefined();
    });
    it('fails when GrossAmount is missing', () => {
      expect(createPayDetailSchema.validate({ AccountTypeBaseId: VALID_UUID_PD, TransactionDetailLogId: VALID_UUID_PD, TotalAmount: '1000' }).error).toBeDefined();
    });
    it('fails when AccountTypeBaseId is not a valid UUID', () => {
      expect(createPayDetailSchema.validate({ AccountTypeBaseId: 'bad', TransactionDetailLogId: VALID_UUID_PD, TotalAmount: '1000', GrossAmount: '1000' }).error).toBeDefined();
    });
    it('fails when TotalAmount exceeds 50 characters', () => {
      expect(createPayDetailSchema.validate({ AccountTypeBaseId: VALID_UUID_PD, TransactionDetailLogId: VALID_UUID_PD, TotalAmount: '1'.repeat(51), GrossAmount: '1000' }).error).toBeDefined();
    });
    it('fails when UserId is not a valid UUID', () => {
      expect(createPayDetailSchema.validate({ AccountTypeBaseId: VALID_UUID_PD, TransactionDetailLogId: VALID_UUID_PD, TotalAmount: '1000', GrossAmount: '1000', UserId: 'not-uuid' }).error).toBeDefined();
    });
  });

  describe('update schema — positive cases', () => {
    it('passes with only TotalAmount patch', () => {
      expect(updatePayDetailSchema.validate({ TotalAmount: '2000' }).error).toBeUndefined();
    });
    it('passes with only Active flag', () => {
      expect(updatePayDetailSchema.validate({ Active: false }).error).toBeUndefined();
    });
    it('passes with DiscountAmount as null', () => {
      expect(updatePayDetailSchema.validate({ DiscountAmount: null }).error).toBeUndefined();
    });
    it('passes with UserId as null', () => {
      expect(updatePayDetailSchema.validate({ UserId: null }).error).toBeUndefined();
    });
  });

  describe('update schema — negative cases', () => {
    it('fails for an empty body', () => {
      expect(updatePayDetailSchema.validate({}).error).toBeDefined();
    });
    it('fails when AccountTypeBaseId is invalid UUID', () => {
      expect(updatePayDetailSchema.validate({ AccountTypeBaseId: 'bad' }).error).toBeDefined();
    });
    it('fails when TotalAmount exceeds 50 characters', () => {
      expect(updatePayDetailSchema.validate({ TotalAmount: '1'.repeat(51) }).error).toBeDefined();
    });
    it('fails when GrossAmount exceeds 50 characters', () => {
      expect(updatePayDetailSchema.validate({ GrossAmount: 'x'.repeat(51) }).error).toBeDefined();
    });
  });
});
