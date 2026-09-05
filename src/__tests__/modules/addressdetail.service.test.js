/**
 * addressdetail.service.test.js
 *
 * Unit tests for the addressdetail service layer.
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
  MODULE_REGISTRY.find((m) => m.name === 'addressdetail');

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

const VALID_UUID_AD = 'a1b2c3d4-1111-1111-1111-111111111111';

describe('addressdetail — field validation', () => {
  const { createSchema: createAddressSchema, updateSchema: updateAddressSchema } =
    require('../../modules/addressdetail/addressdetail.schemas');

  // The DB (source of truth) requires ContactAddressTypeId (NOT NULL) on every
  // address row, so it is part of the minimal valid create payload.
  // MapProviderLocationMapperId (Location Mapper) is nullable/optional.
  const REQUIRED_AD = {
    AddressLine1: '123 Main St',
    TagName: 'HOME',
    ContactAddressTypeId: VALID_UUID_AD,
  };

  describe('create schema — positive cases', () => {
    it('passes with all required fields', () => {
      expect(createAddressSchema.validate({ ...REQUIRED_AD }).error).toBeUndefined();
    });
    it('passes with all fields provided', () => {
      const data = {
        AddressLine1: '123 Main St', AddressLine2: 'Apt 4', City: 'Bengaluru',
        State: 'Karnataka', Pincode: '560001', MapProviderLocationMapperId: VALID_UUID_AD,
        Landmark: 'Near park', ContactAddressTypeId: VALID_UUID_AD, TagName: 'MAIN', Active: true,
      };
      expect(createAddressSchema.validate(data).error).toBeUndefined();
    });
    it('accepts optional fields as null', () => {
      expect(createAddressSchema.validate({ ...REQUIRED_AD, City: null, State: null }).error).toBeUndefined();
    });
    it('accepts optional fields as empty string', () => {
      expect(createAddressSchema.validate({ ...REQUIRED_AD, City: '', State: '' }).error).toBeUndefined();
    });
    it('accepts TagName at exactly 100 characters', () => {
      expect(createAddressSchema.validate({ ...REQUIRED_AD, TagName: 'x'.repeat(100) }).error).toBeUndefined();
    });
    it('defaults Active to true when omitted', () => {
      const { value } = createAddressSchema.validate({ ...REQUIRED_AD });
      expect(value.Active).toBe(true);
    });
    it('passes when MapProviderLocationMapperId is omitted (optional)', () => {
      expect(createAddressSchema.validate({ ...REQUIRED_AD }).error).toBeUndefined();
    });
    it('passes when MapProviderLocationMapperId is null (optional)', () => {
      expect(createAddressSchema.validate({ ...REQUIRED_AD, MapProviderLocationMapperId: null }).error).toBeUndefined();
    });
    it('passes when MapProviderLocationMapperId is a valid UUID', () => {
      expect(createAddressSchema.validate({ ...REQUIRED_AD, MapProviderLocationMapperId: VALID_UUID_AD }).error).toBeUndefined();
    });
  });

  describe('create schema — negative cases', () => {
    it('fails when AddressLine1 is missing', () => {
      const { AddressLine1, ...rest } = REQUIRED_AD;
      expect(createAddressSchema.validate(rest).error).toBeDefined();
    });
    it('fails when TagName is missing', () => {
      const { TagName, ...rest } = REQUIRED_AD;
      expect(createAddressSchema.validate(rest).error).toBeDefined();
    });
    it('fails when ContactAddressTypeId is missing', () => {
      const { ContactAddressTypeId, ...rest } = REQUIRED_AD;
      expect(createAddressSchema.validate(rest).error).toBeDefined();
    });
    it('fails when AddressLine1 exceeds 50 characters', () => {
      expect(createAddressSchema.validate({ ...REQUIRED_AD, AddressLine1: 'x'.repeat(51) }).error).toBeDefined();
    });
    it('fails when TagName exceeds 100 characters', () => {
      expect(createAddressSchema.validate({ ...REQUIRED_AD, TagName: 'x'.repeat(101) }).error).toBeDefined();
    });
    it('fails when MapProviderLocationMapperId is not a valid UUID', () => {
      expect(createAddressSchema.validate({ ...REQUIRED_AD, MapProviderLocationMapperId: 'bad' }).error).toBeDefined();
    });
    it('fails when ContactAddressTypeId is not a valid UUID', () => {
      expect(createAddressSchema.validate({ ...REQUIRED_AD, ContactAddressTypeId: 'bad' }).error).toBeDefined();
    });
    it('fails when Pincode exceeds 50 characters', () => {
      expect(createAddressSchema.validate({ ...REQUIRED_AD, Pincode: '1'.repeat(51) }).error).toBeDefined();
    });
  });

  describe('update schema — positive cases', () => {
    it('passes with City patch', () => {
      expect(updateAddressSchema.validate({ City: 'Mumbai' }).error).toBeUndefined();
    });
    it('passes with TagName patch', () => {
      expect(updateAddressSchema.validate({ TagName: 'NEW_TAG' }).error).toBeUndefined();
    });
    it('passes with only Active flag', () => {
      expect(updateAddressSchema.validate({ Active: false }).error).toBeUndefined();
    });
    it('passes with City as null', () => {
      expect(updateAddressSchema.validate({ City: null }).error).toBeUndefined();
    });
  });

  describe('update schema — negative cases', () => {
    it('fails for an empty body', () => {
      expect(updateAddressSchema.validate({}).error).toBeDefined();
    });
    it('fails when AddressLine1 exceeds 50 characters', () => {
      expect(updateAddressSchema.validate({ AddressLine1: 'x'.repeat(51) }).error).toBeDefined();
    });
    it('fails when MapProviderLocationMapperId is not a valid UUID', () => {
      expect(updateAddressSchema.validate({ MapProviderLocationMapperId: 'not-uuid' }).error).toBeDefined();
    });
  });
});
