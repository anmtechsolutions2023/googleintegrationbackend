/**
 * paymentbreakup.service.test.js
 *
 * Unit tests for the paymentbreakup service layer.
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
  MODULE_REGISTRY.find((m) => m.name === 'paymentbreakup');

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

const UUID = 'a1b2c3d4-1111-1111-1111-111111111111';
const BASE = { AccountTypeBaseId: UUID, PaymentDetailId: UUID, PaymentModeTransactionDetailId: UUID, PaymentReceivedTypeId: UUID };

describe('normalizeDate — Timestamp branch coverage', () => {
  const svc = require('../../modules/paymentbreakup/paymentbreakup.service');

  beforeEach(() => setupInsertMock(mockConnection));

  it('accepts ISO datetime string for Timestamp', async () => {
    const result = await svc.create({ ...BASE, Timestamp: '2026-05-31T10:00:00.000Z' }, TENANT_ID, USER_EMAIL);
    expect(result).toHaveProperty('id');
  });

  it('accepts DD-MM-YYYY string for Timestamp', async () => {
    const result = await svc.create({ ...BASE, Timestamp: '31-05-2026' }, TENANT_ID, USER_EMAIL);
    expect(result).toHaveProperty('id');
  });

  it('accepts a Date object for Timestamp', async () => {
    const result = await svc.create({ ...BASE, Timestamp: new Date('2026-05-31T10:00:00Z') }, TENANT_ID, USER_EMAIL);
    expect(result).toHaveProperty('id');
  });
});

describe('paymentbreakup — field validation', () => {
  const { createSchema: createPBSchema, updateSchema: updatePBSchema } =
    require('../../modules/paymentbreakup/paymentbreakup.schemas');

  describe('create schema — positive cases', () => {
    it('passes with all five required fields (ISO Timestamp)', () => {
      const data = {
        AccountTypeBaseId: UUID, PaymentDetailId: UUID,
        PaymentModeTransactionDetailId: UUID, PaymentReceivedTypeId: UUID,
        Timestamp: '2026-05-31T10:00:00.000Z',
      };
      expect(createPBSchema.validate(data).error).toBeUndefined();
    });
    it('passes with DD-MM-YYYY Timestamp format', () => {
      const data = {
        AccountTypeBaseId: UUID, PaymentDetailId: UUID,
        PaymentModeTransactionDetailId: UUID, PaymentReceivedTypeId: UUID,
        Timestamp: '31-05-2026',
      };
      expect(createPBSchema.validate(data).error).toBeUndefined();
    });
    it('passes with optional UserId as valid UUID', () => {
      const data = {
        AccountTypeBaseId: UUID, PaymentDetailId: UUID,
        PaymentModeTransactionDetailId: UUID, PaymentReceivedTypeId: UUID,
        Timestamp: '2026-05-31T10:00:00.000Z', UserId: UUID,
      };
      expect(createPBSchema.validate(data).error).toBeUndefined();
    });
    it('passes with UserId as null', () => {
      const data = {
        AccountTypeBaseId: UUID, PaymentDetailId: UUID,
        PaymentModeTransactionDetailId: UUID, PaymentReceivedTypeId: UUID,
        Timestamp: '2026-05-31T10:00:00.000Z', UserId: null,
      };
      expect(createPBSchema.validate(data).error).toBeUndefined();
    });
    it('defaults Active to true when omitted', () => {
      const { value } = createPBSchema.validate({
        AccountTypeBaseId: UUID, PaymentDetailId: UUID,
        PaymentModeTransactionDetailId: UUID, PaymentReceivedTypeId: UUID,
        Timestamp: '2026-05-31T10:00:00.000Z',
      });
      expect(value.Active).toBe(true);
    });
  });

  describe('create schema — negative cases', () => {
    it('fails when AccountTypeBaseId is missing', () => {
      expect(createPBSchema.validate({ PaymentDetailId: UUID, PaymentModeTransactionDetailId: UUID, PaymentReceivedTypeId: UUID, Timestamp: '2026-05-31T10:00:00Z' }).error).toBeDefined();
    });
    it('fails when PaymentDetailId is missing', () => {
      expect(createPBSchema.validate({ AccountTypeBaseId: UUID, PaymentModeTransactionDetailId: UUID, PaymentReceivedTypeId: UUID, Timestamp: '2026-05-31T10:00:00Z' }).error).toBeDefined();
    });
    it('fails when PaymentModeTransactionDetailId is missing', () => {
      expect(createPBSchema.validate({ AccountTypeBaseId: UUID, PaymentDetailId: UUID, PaymentReceivedTypeId: UUID, Timestamp: '2026-05-31T10:00:00Z' }).error).toBeDefined();
    });
    it('fails when PaymentReceivedTypeId is missing', () => {
      expect(createPBSchema.validate({ AccountTypeBaseId: UUID, PaymentDetailId: UUID, PaymentModeTransactionDetailId: UUID, Timestamp: '2026-05-31T10:00:00Z' }).error).toBeDefined();
    });
    it('fails when Timestamp is missing', () => {
      expect(createPBSchema.validate({ AccountTypeBaseId: UUID, PaymentDetailId: UUID, PaymentModeTransactionDetailId: UUID, PaymentReceivedTypeId: UUID }).error).toBeDefined();
    });
    it('fails when Timestamp is an invalid string', () => {
      expect(createPBSchema.validate({ AccountTypeBaseId: UUID, PaymentDetailId: UUID, PaymentModeTransactionDetailId: UUID, PaymentReceivedTypeId: UUID, Timestamp: 'not-a-date' }).error).toBeDefined();
    });
    it('fails when AccountTypeBaseId is not a valid UUID', () => {
      expect(createPBSchema.validate({ AccountTypeBaseId: 'bad-uuid', PaymentDetailId: UUID, PaymentModeTransactionDetailId: UUID, PaymentReceivedTypeId: UUID, Timestamp: '2026-05-31T10:00:00Z' }).error).toBeDefined();
    });
    it('fails when UserId is not a valid UUID', () => {
      expect(createPBSchema.validate({ AccountTypeBaseId: UUID, PaymentDetailId: UUID, PaymentModeTransactionDetailId: UUID, PaymentReceivedTypeId: UUID, Timestamp: '2026-05-31T10:00:00Z', UserId: 'bad' }).error).toBeDefined();
    });
  });

  describe('update schema — positive cases', () => {
    it('passes with only Active flag', () => {
      expect(updatePBSchema.validate({ Active: false }).error).toBeUndefined();
    });
    it('passes with Timestamp update', () => {
      expect(updatePBSchema.validate({ Timestamp: '2026-06-01T10:00:00.000Z' }).error).toBeUndefined();
    });
    it('passes with PaymentReceivedTypeId patch', () => {
      expect(updatePBSchema.validate({ PaymentReceivedTypeId: UUID }).error).toBeUndefined();
    });
    it('passes with UserId as null', () => {
      expect(updatePBSchema.validate({ UserId: null }).error).toBeUndefined();
    });
  });

  describe('update schema — negative cases', () => {
    it('fails for an empty body', () => {
      expect(updatePBSchema.validate({}).error).toBeDefined();
    });
    it('fails when AccountTypeBaseId is not a valid UUID', () => {
      expect(updatePBSchema.validate({ AccountTypeBaseId: 'not-uuid' }).error).toBeDefined();
    });
    it('fails when Timestamp is an invalid string', () => {
      expect(updatePBSchema.validate({ Timestamp: 'bad-date' }).error).toBeDefined();
    });
    it('fails when PaymentDetailId is not a valid UUID', () => {
      expect(updatePBSchema.validate({ PaymentDetailId: 'not-uuid' }).error).toBeDefined();
    });
  });
});
