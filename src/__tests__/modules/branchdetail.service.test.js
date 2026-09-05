/**
 * branchdetail.service.test.js
 *
 * Unit tests for the branchdetail service layer.
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
  MODULE_REGISTRY.find((m) => m.name === 'branchdetail');

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

const VALID_UUID_BD = 'a1b2c3d4-1111-1111-1111-111111111111';

describe('branchdetail — field validation', () => {
  const { createSchema: createBranchSchema, updateSchema: updateBranchSchema } =
    require('../../modules/branchdetail/branchdetail.schemas');

  describe('create schema — positive cases', () => {
    it('passes with BranchName', () => {
      expect(createBranchSchema.validate({ BranchName: 'Head Office' }).error).toBeUndefined();
    });
    it('passes with legacy Name alias', () => {
      expect(createBranchSchema.validate({ Name: 'Regional' }).error).toBeUndefined();
    });
    it('passes with all required UUID fields', () => {
      const data = {
        BranchName: 'HQ', OrganizationDetailId: VALID_UUID_BD, ContactDetailId: VALID_UUID_BD,
        AddressDetailId: VALID_UUID_BD, TransactionTypeConfigId: VALID_UUID_BD,
      };
      expect(createBranchSchema.validate(data).error).toBeUndefined();
    });
    it('passes with optional tax fields', () => {
      expect(createBranchSchema.validate({ BranchName: 'Branch', GSTIN: '29ABCDE1234F1Z5', TINNo: '123', PAN: 'ABCDE1234F' }).error).toBeUndefined();
    });
    it('passes with CF fields as null', () => {
      expect(createBranchSchema.validate({ BranchName: 'HQ', CF1: null, CF2: null }).error).toBeUndefined();
    });
    it('accepts BranchName at exactly 100 characters', () => {
      expect(createBranchSchema.validate({ BranchName: 'x'.repeat(100) }).error).toBeUndefined();
    });
    it('defaults Active to true when omitted', () => {
      const { value } = createBranchSchema.validate({ BranchName: 'HQ' });
      expect(value.Active).toBe(true);
    });
  });

  describe('create schema — negative cases', () => {
    it('fails when neither BranchName nor Name is provided', () => {
      expect(createBranchSchema.validate({}).error).toBeDefined();
    });
    it('fails when BranchName exceeds 100 characters', () => {
      expect(createBranchSchema.validate({ BranchName: 'x'.repeat(101) }).error).toBeDefined();
    });
    it('fails when OrganizationDetailId is not a valid UUID', () => {
      expect(createBranchSchema.validate({ BranchName: 'HQ', OrganizationDetailId: 'bad' }).error).toBeDefined();
    });
    it('fails when GSTIN exceeds 50 characters', () => {
      expect(createBranchSchema.validate({ BranchName: 'HQ', GSTIN: 'x'.repeat(51) }).error).toBeDefined();
    });
    it('fails when Active is not a boolean', () => {
      expect(createBranchSchema.validate({ BranchName: 'HQ', Active: 1 }).error).toBeDefined();
    });
  });

  describe('update schema — positive cases', () => {
    it('passes with BranchName patch', () => {
      expect(updateBranchSchema.validate({ BranchName: 'New Branch' }).error).toBeUndefined();
    });
    it('passes with legacy Name alias', () => {
      expect(updateBranchSchema.validate({ Name: 'Regional' }).error).toBeUndefined();
    });
    it('passes with BranchName and Active flag', () => {
      expect(updateBranchSchema.validate({ BranchName: 'HQ', Active: false }).error).toBeUndefined();
    });
    it('passes with BranchName and GSTIN as null', () => {
      expect(updateBranchSchema.validate({ BranchName: 'HQ', GSTIN: null }).error).toBeUndefined();
    });
    it('passes with BranchName and CF1 update', () => {
      expect(updateBranchSchema.validate({ BranchName: 'HQ', CF1: 'Zone A' }).error).toBeUndefined();
    });
  });

  describe('update schema — negative cases', () => {
    it('fails for an empty body', () => {
      expect(updateBranchSchema.validate({}).error).toBeDefined();
    });
    it('fails when BranchName exceeds 100 characters', () => {
      expect(updateBranchSchema.validate({ BranchName: 'x'.repeat(101) }).error).toBeDefined();
    });
    it('fails when AddressDetailId is not a valid UUID', () => {
      expect(updateBranchSchema.validate({ AddressDetailId: 'not-uuid' }).error).toBeDefined();
    });
  });
});
