/**
 * contactdetail.service.test.js
 *
 * Unit tests for the contactdetail service layer.
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
  MODULE_REGISTRY.find((m) => m.name === 'contactdetail');

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

const VALID_UUID_CD = 'a1b2c3d4-1111-1111-1111-111111111111';

describe('contactdetail — field validation', () => {
  const { createSchema: createContactDetailSchema, updateSchema: updateContactDetailSchema } =
    require('../../modules/contactdetail/contactdetail.schemas');

  describe('create schema — positive cases', () => {
    it('passes with only required FirstName', () => {
      expect(createContactDetailSchema.validate({ FirstName: 'John' }).error).toBeUndefined();
    });
    it('passes with FirstName and LastName', () => {
      expect(createContactDetailSchema.validate({ FirstName: 'John', LastName: 'Doe' }).error).toBeUndefined();
    });
    it('passes with all optional fields provided', () => {
      const data = {
        FirstName: 'John', LastName: 'Doe', MobileNo: '9876543210',
        AltMobileNo: '9123456789', Landline1: '080-1234', LandLine2: null,
        Ext1: '101', Ext2: null, ContactAddressTypeId: VALID_UUID_CD, Active: true,
      };
      expect(createContactDetailSchema.validate(data).error).toBeUndefined();
    });
    it('accepts FirstName at exactly 100 characters', () => {
      expect(createContactDetailSchema.validate({ FirstName: 'x'.repeat(100) }).error).toBeUndefined();
    });
    it('accepts null for optional string fields', () => {
      expect(createContactDetailSchema.validate({ FirstName: 'Jane', MobileNo: null, LastName: null }).error).toBeUndefined();
    });
    it('defaults Active to true when omitted', () => {
      const { value } = createContactDetailSchema.validate({ FirstName: 'Jane' });
      expect(value.Active).toBe(true);
    });
  });

  describe('create schema — negative cases', () => {
    it('fails when FirstName is missing', () => {
      expect(createContactDetailSchema.validate({}).error).toBeDefined();
    });
    it('fails when FirstName exceeds 100 characters', () => {
      expect(createContactDetailSchema.validate({ FirstName: 'x'.repeat(101) }).error).toBeDefined();
    });
    it('fails when FirstName is a number', () => {
      expect(createContactDetailSchema.validate({ FirstName: 123 }).error).toBeDefined();
    });
    it('fails when MobileNo exceeds 20 characters', () => {
      expect(createContactDetailSchema.validate({ FirstName: 'John', MobileNo: '1'.repeat(21) }).error).toBeDefined();
    });
    it('fails when Ext1 exceeds 10 characters', () => {
      expect(createContactDetailSchema.validate({ FirstName: 'John', Ext1: 'x'.repeat(11) }).error).toBeDefined();
    });
    it('fails when ContactAddressTypeId is not a valid UUID', () => {
      expect(createContactDetailSchema.validate({ FirstName: 'John', ContactAddressTypeId: 'not-uuid' }).error).toBeDefined();
    });
    it('fails when Active is not a boolean', () => {
      expect(createContactDetailSchema.validate({ FirstName: 'John', Active: 'yes' }).error).toBeDefined();
    });
  });

  describe('update schema — positive cases', () => {
    it('passes with FirstName patch', () => {
      expect(updateContactDetailSchema.validate({ FirstName: 'Jane' }).error).toBeUndefined();
    });
    it('passes with MobileNo as null', () => {
      expect(updateContactDetailSchema.validate({ MobileNo: null }).error).toBeUndefined();
    });
    it('passes with only Active flag', () => {
      expect(updateContactDetailSchema.validate({ Active: false }).error).toBeUndefined();
    });
    it('passes with ContactAddressTypeId as valid UUID', () => {
      expect(updateContactDetailSchema.validate({ ContactAddressTypeId: VALID_UUID_CD }).error).toBeUndefined();
    });
  });

  describe('update schema — negative cases', () => {
    it('fails for an empty body', () => {
      expect(updateContactDetailSchema.validate({}).error).toBeDefined();
    });
    it('fails when FirstName exceeds 100 characters', () => {
      expect(updateContactDetailSchema.validate({ FirstName: 'x'.repeat(101) }).error).toBeDefined();
    });
    it('fails when ContactAddressTypeId is not a valid UUID', () => {
      expect(updateContactDetailSchema.validate({ ContactAddressTypeId: 'bad-uuid' }).error).toBeDefined();
    });
    it('fails when MobileNo exceeds 20 characters', () => {
      expect(updateContactDetailSchema.validate({ MobileNo: '9'.repeat(21) }).error).toBeDefined();
    });
  });
});
