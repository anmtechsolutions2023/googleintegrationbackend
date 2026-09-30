/**
 * paymentmode.service.test.js
 *
 * Unit tests for the paymentmode service layer.
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
  MODULE_REGISTRY.find((m) => m.name === 'paymentmode');

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

describe('paymentmode — field validation', () => {
  const { createSchema: createPaymentModeSchema, updateSchema: updatePaymentModeSchema } =
    require('../../modules/paymentmode/paymentmode.schemas');

  // A tender says where money LANDS, so an account is not optional decoration:
  // a method without one books nowhere and disappears from every report that
  // groups by account. Every create case below therefore carries one.
  const ACCOUNT = 'b0000001-ldgr-0000-0000-000000000002';

  describe('create schema — positive cases', () => {
    it('passes with a valid Type', () => {
      expect(createPaymentModeSchema.validate({
        Type: 'Cash', DefaultAccountTypeBaseId: ACCOUNT,
      }).error).toBeUndefined();
    });
    it('passes with Type and Active false', () => {
      expect(createPaymentModeSchema.validate({
        Type: 'Card', DefaultAccountTypeBaseId: ACCOUNT, Active: false,
      }).error).toBeUndefined();
    });
    it('accepts Type at exactly 50 characters', () => {
      expect(createPaymentModeSchema.validate({
        Type: 'x'.repeat(50), DefaultAccountTypeBaseId: ACCOUNT,
      }).error).toBeUndefined();
    });
    it('defaults Active to true when omitted', () => {
      const { value } = createPaymentModeSchema.validate({
        Type: 'UPI', DefaultAccountTypeBaseId: ACCOUNT,
      });
      expect(value.Active).toBe(true);
    });
    it('defaults RequiresReference off and EnabledByDefault on', () => {
      const { value } = createPaymentModeSchema.validate({
        Type: 'Meal Voucher', DefaultAccountTypeBaseId: ACCOUNT,
      });
      expect(value.RequiresReference).toBe(false);
      expect(value.EnabledByDefault).toBe(true);
    });
    it('strips SortOrder — it is assigned, never supplied', () => {
      const { value } = createPaymentModeSchema.validate({
        Type: 'Cheque', DefaultAccountTypeBaseId: ACCOUNT, SortOrder: 1,
      });
      expect(value.SortOrder).toBeUndefined();
    });
  });

  describe('create schema — negative cases', () => {
    it('fails when Type is missing', () => {
      expect(createPaymentModeSchema.validate({}).error).toBeDefined();
    });
    // The hole this closes: the column existed and the list query joined its
    // name, but no INSERT ever wrote it, so every method made through the API
    // booked to nothing at all.
    it('fails when the ledger account is missing', () => {
      expect(createPaymentModeSchema.validate({ Type: 'Cash' }).error).toBeDefined();
    });
    it('refuses to clear the account on update', () => {
      expect(updatePaymentModeSchema.validate({
        DefaultAccountTypeBaseId: '',
      }).error).toBeDefined();
    });
    it('fails when Type exceeds 50 characters', () => {
      expect(createPaymentModeSchema.validate({ Type: 'x'.repeat(51), DefaultAccountTypeBaseId: ACCOUNT }).error).toBeDefined();
    });
    it('fails when Type is a number', () => {
      expect(createPaymentModeSchema.validate({ Type: 123, DefaultAccountTypeBaseId: ACCOUNT }).error).toBeDefined();
    });
    it('fails when Active is a string', () => {
      expect(createPaymentModeSchema.validate({ Type: 'Cash', DefaultAccountTypeBaseId: ACCOUNT, Active: 'yes' }).error).toBeDefined();
    });
  });

  describe('update schema — positive cases', () => {
    it('passes with a valid Type patch', () => {
      expect(updatePaymentModeSchema.validate({ Type: 'Online Transfer' }).error).toBeUndefined();
    });
    it('passes with only Active flag', () => {
      expect(updatePaymentModeSchema.validate({ Active: false }).error).toBeUndefined();
    });
  });

  describe('update schema — negative cases', () => {
    it('fails for an empty body', () => {
      expect(updatePaymentModeSchema.validate({}).error).toBeDefined();
    });
    it('fails when Type exceeds 50 characters', () => {
      expect(updatePaymentModeSchema.validate({ Type: 'x'.repeat(51) }).error).toBeDefined();
    });
  });
});
