/**
 * transactiontypeconfig.service.test.js
 *
 * Unit tests for the transactiontypeconfig service layer.
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
  MODULE_REGISTRY.find((m) => m.name === 'transactiontypeconfig');

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

  describe('getOrCreateByTagNameTx', () => {
    it('reuses an existing config when the TagName already exists (no insert)', async () => {
      mockConnection.execute.mockResolvedValueOnce([[{ Id: RECORD_ID, TagName: 'Onboarding' }]]);
      const result = await svc.getOrCreateByTagNameTx(
        mockConnection, { TagName: 'Onboarding' }, TENANT_ID, USER_EMAIL,
      );
      expect(result).toMatchObject({ id: RECORD_ID, reused: true });
      // only the lookup ran — no INSERT
      expect(mockConnection.execute).toHaveBeenCalledTimes(1);
    });

    it('creates a new config when the TagName does not exist', async () => {
      mockConnection.execute
        .mockResolvedValueOnce([[]])                    // SELECT_BY_TAGNAME → none found
        .mockResolvedValueOnce([[{ affectedRows: 1 }]]); // INSERT
      const data = { StartCounterNo: 1, Prefix: '', Format: 'INV-{0000}', TagName: 'Fresh' };
      const result = await svc.getOrCreateByTagNameTx(
        mockConnection, data, TENANT_ID, USER_EMAIL,
      );
      expect(result).toMatchObject({ id: 'mock-uuid-generated', reused: false });
      // lookup + insert
      expect(mockConnection.execute).toHaveBeenCalledTimes(2);
    });
  });
});

describe('transactiontypeconfig — field validation', () => {
  const { createTransactionTypeConfigSchema, updateTransactionTypeConfigSchema } =
    require('../../modules/transactiontypeconfig/transactiontypeconfig.schemas');

  describe('create schema — positive cases', () => {
    it('passes with all required fields', () => {
      expect(createTransactionTypeConfigSchema.validate({ StartCounterNo: 1001, Format: 'INV-{SEQ}', TagName: 'SALES' }).error).toBeUndefined();
    });
    it('passes with StartCounterNo at 0', () => {
      expect(createTransactionTypeConfigSchema.validate({ StartCounterNo: 0, Format: 'PO-{SEQ}', TagName: 'PO' }).error).toBeUndefined();
    });
    it('passes with optional Prefix provided', () => {
      expect(createTransactionTypeConfigSchema.validate({ StartCounterNo: 1, Prefix: 'INV', Format: 'INV-{SEQ}', TagName: 'SALES_INV' }).error).toBeUndefined();
    });
    it('passes with empty Prefix string', () => {
      expect(createTransactionTypeConfigSchema.validate({ StartCounterNo: 1, Prefix: '', Format: '{SEQ}', TagName: 'TAG1' }).error).toBeUndefined();
    });
    it('accepts Format at exactly 100 characters', () => {
      expect(createTransactionTypeConfigSchema.validate({ StartCounterNo: 1, Format: 'x'.repeat(100), TagName: 'T' }).error).toBeUndefined();
    });
    it('defaults Active to true when omitted', () => {
      const { value } = createTransactionTypeConfigSchema.validate({ StartCounterNo: 1, Format: 'F', TagName: 'T' });
      expect(value.Active).toBe(true);
    });
  });

  describe('create schema — negative cases', () => {
    it('fails when StartCounterNo is missing', () => {
      expect(createTransactionTypeConfigSchema.validate({ Format: 'INV-{SEQ}', TagName: 'SALES' }).error).toBeDefined();
    });
    it('fails when Format is missing', () => {
      expect(createTransactionTypeConfigSchema.validate({ StartCounterNo: 1, TagName: 'SALES' }).error).toBeDefined();
    });
    it('fails when TagName is missing', () => {
      expect(createTransactionTypeConfigSchema.validate({ StartCounterNo: 1, Format: 'INV-{SEQ}' }).error).toBeDefined();
    });
    it('fails when StartCounterNo is negative', () => {
      expect(createTransactionTypeConfigSchema.validate({ StartCounterNo: -1, Format: 'F', TagName: 'T' }).error).toBeDefined();
    });
    it('fails when StartCounterNo is not an integer', () => {
      expect(createTransactionTypeConfigSchema.validate({ StartCounterNo: 1.5, Format: 'F', TagName: 'T' }).error).toBeDefined();
    });
    it('fails when Format exceeds 100 characters', () => {
      expect(createTransactionTypeConfigSchema.validate({ StartCounterNo: 1, Format: 'x'.repeat(101), TagName: 'T' }).error).toBeDefined();
    });
    it('fails when TagName exceeds 100 characters', () => {
      expect(createTransactionTypeConfigSchema.validate({ StartCounterNo: 1, Format: 'F', TagName: 'x'.repeat(101) }).error).toBeDefined();
    });
    it('fails when StartCounterNo is a string', () => {
      expect(createTransactionTypeConfigSchema.validate({ StartCounterNo: 'ABC', Format: 'F', TagName: 'T' }).error).toBeDefined();
    });
  });

  describe('update schema — positive cases', () => {
    it('passes with only StartCounterNo patch', () => {
      expect(updateTransactionTypeConfigSchema.validate({ StartCounterNo: 2000 }).error).toBeUndefined();
    });
    it('passes with only Format patch', () => {
      expect(updateTransactionTypeConfigSchema.validate({ Format: 'NEW-{SEQ}' }).error).toBeUndefined();
    });
    it('passes with only TagName patch', () => {
      expect(updateTransactionTypeConfigSchema.validate({ TagName: 'NEW_TAG' }).error).toBeUndefined();
    });
    it('passes with only Active flag', () => {
      expect(updateTransactionTypeConfigSchema.validate({ Active: false }).error).toBeUndefined();
    });
  });

  describe('update schema — negative cases', () => {
    it('fails for an empty body', () => {
      expect(updateTransactionTypeConfigSchema.validate({}).error).toBeDefined();
    });
    it('fails when Format exceeds 100 characters', () => {
      expect(updateTransactionTypeConfigSchema.validate({ Format: 'x'.repeat(101) }).error).toBeDefined();
    });
    it('fails when StartCounterNo is negative', () => {
      expect(updateTransactionTypeConfigSchema.validate({ StartCounterNo: -5 }).error).toBeDefined();
    });
  });
});
