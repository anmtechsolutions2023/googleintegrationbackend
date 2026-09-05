/**
 * branchusergroupmapper.service.test.js
 *
 * Unit tests for the branchusergroupmapper service layer.
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
  MODULE_REGISTRY.find((m) => m.name === 'branchusergroupmapper');

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

const VALID_UUID_BUGM = 'a1b2c3d4-1111-1111-1111-111111111111';

describe('branchusergroupmapper — field validation', () => {
  const { createSchema: createBUGMSchema, updateSchema: updateBUGMSchema } =
    require('../../modules/branchusergroupmapper/branchusergroupmapper.schemas');

  describe('create schema — positive cases', () => {
    it('passes with valid BranchDetailId and UserGroupId', () => {
      expect(createBUGMSchema.validate({ BranchDetailId: VALID_UUID_BUGM, UserGroupId: VALID_UUID_BUGM }).error).toBeUndefined();
    });
    it('passes with Active false', () => {
      expect(createBUGMSchema.validate({ BranchDetailId: VALID_UUID_BUGM, UserGroupId: VALID_UUID_BUGM, Active: false }).error).toBeUndefined();
    });
    it('defaults Active to true when omitted', () => {
      const { value } = createBUGMSchema.validate({ BranchDetailId: VALID_UUID_BUGM, UserGroupId: VALID_UUID_BUGM });
      expect(value.Active).toBe(true);
    });
  });

  describe('create schema — negative cases', () => {
    it('fails when BranchDetailId is missing', () => {
      expect(createBUGMSchema.validate({ UserGroupId: VALID_UUID_BUGM }).error).toBeDefined();
    });
    it('fails when UserGroupId is missing', () => {
      expect(createBUGMSchema.validate({ BranchDetailId: VALID_UUID_BUGM }).error).toBeDefined();
    });
    it('fails when both fields are missing', () => {
      expect(createBUGMSchema.validate({}).error).toBeDefined();
    });
    it('fails when BranchDetailId is not a valid UUID', () => {
      expect(createBUGMSchema.validate({ BranchDetailId: 'not-uuid', UserGroupId: VALID_UUID_BUGM }).error).toBeDefined();
    });
    it('fails when UserGroupId is not a valid UUID', () => {
      expect(createBUGMSchema.validate({ BranchDetailId: VALID_UUID_BUGM, UserGroupId: '12345' }).error).toBeDefined();
    });
    it('fails when Active is not a boolean', () => {
      expect(createBUGMSchema.validate({ BranchDetailId: VALID_UUID_BUGM, UserGroupId: VALID_UUID_BUGM, Active: 'yes' }).error).toBeDefined();
    });
  });

  describe('update schema — positive cases', () => {
    it('passes with only Active flag', () => {
      expect(updateBUGMSchema.validate({ Active: false }).error).toBeUndefined();
    });
    it('passes with BranchDetailId patch', () => {
      expect(updateBUGMSchema.validate({ BranchDetailId: VALID_UUID_BUGM }).error).toBeUndefined();
    });
    it('passes with UserGroupId patch', () => {
      expect(updateBUGMSchema.validate({ UserGroupId: VALID_UUID_BUGM }).error).toBeUndefined();
    });
  });

  describe('update schema — negative cases', () => {
    it('fails for an empty body', () => {
      expect(updateBUGMSchema.validate({}).error).toBeDefined();
    });
    it('fails when BranchDetailId is invalid UUID', () => {
      expect(updateBUGMSchema.validate({ BranchDetailId: 'bad-id' }).error).toBeDefined();
    });
    it('fails when UserGroupId is invalid UUID', () => {
      expect(updateBUGMSchema.validate({ UserGroupId: 'not-valid' }).error).toBeDefined();
    });
  });
});
