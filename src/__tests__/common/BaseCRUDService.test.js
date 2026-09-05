// src/__tests__/common/BaseCRUDService.test.js
// Comprehensive unit tests for BaseCRUDService

jest.mock('../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
  captureAudit: jest.fn(),
}));

const mockConnection = {
  execute: jest.fn(),
  query: jest.fn(),
  release: jest.fn(),
  beginTransaction: jest.fn(),
  commit: jest.fn(),
  rollback: jest.fn(),
};

jest.mock('../../utils/dbHelper', () => ({
  withConnection: jest.fn((cb) => cb(mockConnection)),
  withTransaction: jest.fn((cb) => cb(mockConnection)),
  findOneOrFail: jest.fn(),
  findAll: jest.fn(),
  executeQuery: jest.fn(),
}));

jest.mock('../../middleware/errorHandler', () => {
  class HttpError extends Error {
    constructor(message, statusCode) {
      super(message);
      this.statusCode = statusCode;
    }
  }
  return { HttpError };
});

jest.mock('uuid', () => ({ v4: jest.fn(() => 'mock-uuid-1234') }));

const BaseCRUDService = require('../../common/BaseCRUDService');
const { withConnection } = require('../../utils/dbHelper');
const { HttpError } = require('../../middleware/errorHandler');

const TEST_ID = 'f1f1f1f1-0000-0000-0000-000000000001';
const TEST_TENANT = 'e3845e08-dcc2-11f0-8e78-0242ac110002';
const TEST_USER = 'test@example.com';

const QUERIES = {
  SELECT_ALL: 'SELECT * FROM items WHERE TenantId = ? ORDER BY CreatedOn DESC',
  SELECT_ALL_WITH_DETAILS: 'SELECT items.*, rel.Name as RelName FROM items LEFT JOIN rel ON rel.Id = items.RelId WHERE items.TenantId = ? ORDER BY CreatedOn DESC',
  COUNT: 'SELECT COUNT(*) as total FROM items WHERE TenantId = ?',
  SELECT_BY_ID: 'SELECT * FROM items WHERE Id = ? AND TenantId = ?',
  SELECT_BY_ID_WITH_DETAILS: 'SELECT items.*, rel.Name as RelName FROM items LEFT JOIN rel ON rel.Id = items.RelId WHERE items.Id = ? AND items.TenantId = ?',
  INSERT: 'INSERT INTO items (Id, TenantId, Name, Active, CreatedBy, UpdatedBy) VALUES (?, ?, ?, ?, ?, ?)',
  UPDATE: 'UPDATE items SET Name = ?, Active = ?, UpdatedBy = ? WHERE Id = ? AND TenantId = ?',
  DELETE: 'DELETE FROM items WHERE Id = ? AND TenantId = ?',
};

const existingRow = { Id: TEST_ID, TenantId: TEST_TENANT, Name: 'ExistingItem', Active: 1 };

class TestService extends BaseCRUDService {
  constructor() {
    super('Test Item', QUERIES);
  }

  prepareInsertParams(id, data, tenantId, userPhone) {
    return [id, tenantId, data.Name, data.Active !== undefined ? data.Active : true, userPhone, userPhone];
  }

  prepareUpdateParams(data, existing, userPhone, id, tenantId) {
    return [
      data.Name !== undefined ? data.Name : existing.Name,
      data.Active !== undefined ? data.Active : existing.Active,
      userPhone,
      id,
      tenantId,
    ];
  }
}

describe('BaseCRUDService', () => {
  let service;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new TestService();

    mockConnection.execute.mockImplementation((query) => {
      if (query && (query.includes('SELECT') || query.includes('COUNT'))) {
        return Promise.resolve([[existingRow]]);
      }
      return Promise.resolve([[{ affectedRows: 1 }]]);
    });
    mockConnection.query.mockResolvedValue([[existingRow]]);
  });

  describe('constructor', () => {
    it('sets entityName and queries', () => {
      expect(service.entityName).toBe('Test Item');
      expect(service.queries).toBe(QUERIES);
    });
  });

  describe('getAll', () => {
    it('returns paginated data with pagination metadata', async () => {
      mockConnection.execute.mockImplementation((query) => {
        if (query.includes('COUNT')) return Promise.resolve([[{ total: 5 }]]);
        return Promise.resolve([[existingRow]]);
      });
      mockConnection.query.mockResolvedValue([[existingRow, existingRow]]);

      const result = await service.getAll(TEST_TENANT, 1, 10);
      expect(result).toHaveProperty('data');
      expect(result).toHaveProperty('pagination');
      expect(result.pagination.total).toBe(5);
    });

    it('throws HttpError 400 when tenantId is undefined', async () => {
      await expect(service.getAll(undefined, 1, 10)).rejects.toThrow(HttpError);
    });

    it('throws HttpError 400 when tenantId is null', async () => {
      await expect(service.getAll(null, 1, 10)).rejects.toThrow(HttpError);
    });

    it('throws with statusCode 400 for missing tenantId', async () => {
      try {
        await service.getAll(undefined);
      } catch (err) {
        expect(err.statusCode).toBe(400);
      }
    });

    it('uses SELECT_ALL_WITH_DETAILS query when expand=true and query exists', async () => {
      mockConnection.execute.mockImplementation((query) => {
        if (query.includes('COUNT')) return Promise.resolve([[{ total: 1 }]]);
        return Promise.resolve([[existingRow]]);
      });
      mockConnection.query.mockResolvedValue([[existingRow]]);

      await service.getAll(TEST_TENANT, 1, 10, true);
      const queryArg = mockConnection.query.mock.calls[0][0];
      expect(queryArg).toContain('RelName');
    });

    it('uses SELECT_ALL query when expand=false', async () => {
      mockConnection.execute.mockImplementation((query) => {
        if (query.includes('COUNT')) return Promise.resolve([[{ total: 1 }]]);
        return Promise.resolve([[existingRow]]);
      });
      mockConnection.query.mockResolvedValue([[existingRow]]);

      await service.getAll(TEST_TENANT, 1, 10, false);
      const queryArg = mockConnection.query.mock.calls[0][0];
      expect(queryArg).toContain('LIMIT');
    });

    it('calls withConnection', async () => {
      mockConnection.execute.mockImplementation((query) => {
        if (query.includes('COUNT')) return Promise.resolve([[{ total: 0 }]]);
        return Promise.resolve([[existingRow]]);
      });
      mockConnection.query.mockResolvedValue([[]]);
      await service.getAll(TEST_TENANT);
      expect(withConnection).toHaveBeenCalled();
    });

    it('uses default pagination when page/limit omitted', async () => {
      mockConnection.execute.mockImplementation((query) => {
        if (query.includes('COUNT')) return Promise.resolve([[{ total: 2 }]]);
        return Promise.resolve([[existingRow]]);
      });
      mockConnection.query.mockResolvedValue([[existingRow, existingRow]]);

      const result = await service.getAll(TEST_TENANT);
      expect(result.pagination.page).toBe(1);
      expect(result.pagination.limit).toBe(10);
    });
  });

  describe('getById', () => {
    it('returns the record when found', async () => {
      mockConnection.execute.mockResolvedValue([[existingRow]]);
      const result = await service.getById(TEST_ID, TEST_TENANT);
      expect(result).toEqual(existingRow);
    });

    it('throws HttpError 404 when record not found', async () => {
      mockConnection.execute.mockResolvedValue([[]]);
      await expect(service.getById('nonexistent-id', TEST_TENANT)).rejects.toThrow(HttpError);
    });

    it('throws with statusCode 404 when not found', async () => {
      mockConnection.execute.mockResolvedValue([[]]);
      try {
        await service.getById('bad-id', TEST_TENANT);
      } catch (err) {
        expect(err.statusCode).toBe(404);
      }
    });

    it('throws with error message containing entityName when not found', async () => {
      mockConnection.execute.mockResolvedValue([[]]);
      try {
        await service.getById('bad-id', TEST_TENANT);
      } catch (err) {
        expect(err.message).toContain('Test Item');
      }
    });

    it('uses SELECT_BY_ID_WITH_DETAILS when expand=true', async () => {
      mockConnection.execute.mockResolvedValue([[existingRow]]);
      await service.getById(TEST_ID, TEST_TENANT, true);
      const query = mockConnection.execute.mock.calls[0][0];
      expect(query).toContain('RelName');
    });

    it('uses SELECT_BY_ID when expand=false', async () => {
      mockConnection.execute.mockResolvedValue([[existingRow]]);
      await service.getById(TEST_ID, TEST_TENANT, false);
      const query = mockConnection.execute.mock.calls[0][0];
      expect(query).toContain('SELECT * FROM items');
    });

    it('passes id and tenantId as parameters', async () => {
      mockConnection.execute.mockResolvedValue([[existingRow]]);
      await service.getById(TEST_ID, TEST_TENANT);
      expect(mockConnection.execute).toHaveBeenCalledWith(
        expect.any(String),
        [TEST_ID, TEST_TENANT]
      );
    });
  });

  describe('create', () => {
    it('returns created object with id and data', async () => {
      mockConnection.execute.mockResolvedValue([[{ affectedRows: 1 }]]);
      const data = { Name: 'New Item', Active: true };
      const result = await service.create(data, TEST_TENANT, TEST_USER);
      expect(result).toHaveProperty('id');
      expect(result.Name).toBe('New Item');
    });

    it('uses the uuid generated id', async () => {
      mockConnection.execute.mockResolvedValue([[{ affectedRows: 1 }]]);
      const result = await service.create({ Name: 'X', Active: true }, TEST_TENANT, TEST_USER);
      expect(result.id).toBe('mock-uuid-1234');
    });

    it('calls connection.execute with INSERT query', async () => {
      mockConnection.execute.mockResolvedValue([[{ affectedRows: 1 }]]);
      await service.create({ Name: 'X', Active: true }, TEST_TENANT, TEST_USER);
      expect(mockConnection.execute).toHaveBeenCalledWith(QUERIES.INSERT, expect.any(Array));
    });

    it('throws HttpError 400 when params contain undefined', async () => {
      // Create a service where prepareInsertParams returns undefined values
      class BrokenService extends BaseCRUDService {
        constructor() { super('Broken', QUERIES); }
        prepareInsertParams() { return [undefined, 'a', 'b']; }
      }
      const broken = new BrokenService();
      await expect(
        broken.create({ Name: undefined }, TEST_TENANT, TEST_USER)
      ).rejects.toThrow(HttpError);
    });

    it('throws with statusCode 400 for undefined params', async () => {
      class BrokenService extends BaseCRUDService {
        constructor() { super('Broken', QUERIES); }
        prepareInsertParams() { return [undefined]; }
      }
      const broken = new BrokenService();
      try {
        await broken.create({}, TEST_TENANT, TEST_USER);
      } catch (err) {
        expect(err.statusCode).toBe(400);
      }
    });
  });

  describe('update', () => {
    it('returns the updated record after update', async () => {
      mockConnection.execute.mockImplementation((query) => {
        if (query && (query.includes('SELECT') || query.includes('COUNT'))) {
          return Promise.resolve([[existingRow]]);
        }
        return Promise.resolve([[{ affectedRows: 1 }]]);
      });
      const result = await service.update(TEST_ID, { Name: 'Updated' }, TEST_TENANT, TEST_USER);
      expect(result).toEqual(existingRow);
    });

    it('calls getById before executing UPDATE to check existence', async () => {
      mockConnection.execute.mockImplementation((query) => {
        if (query && (query.includes('SELECT') || query.includes('COUNT'))) {
          return Promise.resolve([[existingRow]]);
        }
        return Promise.resolve([[{ affectedRows: 1 }]]);
      });
      await service.update(TEST_ID, { Name: 'Updated' }, TEST_TENANT, TEST_USER);
      const selectCalls = mockConnection.execute.mock.calls.filter(
        ([q]) => q && q.includes('SELECT')
      );
      expect(selectCalls.length).toBeGreaterThanOrEqual(1);
    });

    it('throws HttpError 404 when record does not exist', async () => {
      mockConnection.execute.mockResolvedValue([[]]);
      await expect(
        service.update('nonexistent', { Name: 'Updated' }, TEST_TENANT, TEST_USER)
      ).rejects.toThrow(HttpError);
    });

    it('throws with statusCode 404 when not found', async () => {
      mockConnection.execute.mockResolvedValue([[]]);
      try {
        await service.update('bad-id', { Name: 'X' }, TEST_TENANT, TEST_USER);
      } catch (err) {
        expect(err.statusCode).toBe(404);
      }
    });

    it('executes the UPDATE query', async () => {
      mockConnection.execute.mockImplementation((query) => {
        if (query && (query.includes('SELECT') || query.includes('COUNT'))) {
          return Promise.resolve([[existingRow]]);
        }
        return Promise.resolve([[{ affectedRows: 1 }]]);
      });
      await service.update(TEST_ID, { Name: 'Updated' }, TEST_TENANT, TEST_USER);
      const updateCall = mockConnection.execute.mock.calls.find(
        ([q]) => q && q.includes('UPDATE')
      );
      expect(updateCall).toBeDefined();
    });
  });

  describe('delete', () => {
    it('resolves without error when record exists', async () => {
      mockConnection.execute.mockImplementation((query) => {
        if (query && query.includes('SELECT')) return Promise.resolve([[existingRow]]);
        return Promise.resolve([[{ affectedRows: 1 }]]);
      });
      await expect(service.delete(TEST_ID, TEST_TENANT)).resolves.toBeUndefined();
    });

    it('calls getById before DELETE to verify existence', async () => {
      mockConnection.execute.mockImplementation((query) => {
        if (query && query.includes('SELECT')) return Promise.resolve([[existingRow]]);
        return Promise.resolve([[{ affectedRows: 1 }]]);
      });
      await service.delete(TEST_ID, TEST_TENANT);
      const selectCalls = mockConnection.execute.mock.calls.filter(
        ([q]) => q && q.includes('SELECT')
      );
      expect(selectCalls.length).toBeGreaterThanOrEqual(1);
    });

    it('throws HttpError 404 when record does not exist', async () => {
      mockConnection.execute.mockResolvedValue([[]]);
      await expect(service.delete('nonexistent', TEST_TENANT)).rejects.toThrow(HttpError);
    });

    it('throws with statusCode 404 when not found', async () => {
      mockConnection.execute.mockResolvedValue([[]]);
      try {
        await service.delete('bad-id', TEST_TENANT);
      } catch (err) {
        expect(err.statusCode).toBe(404);
      }
    });

    it('executes the DELETE query with id and tenantId', async () => {
      mockConnection.execute.mockImplementation((query) => {
        if (query && query.includes('SELECT')) return Promise.resolve([[existingRow]]);
        return Promise.resolve([[{ affectedRows: 1 }]]);
      });
      await service.delete(TEST_ID, TEST_TENANT);
      const deleteCall = mockConnection.execute.mock.calls.find(
        ([q]) => q && q.includes('DELETE')
      );
      expect(deleteCall).toBeDefined();
      expect(deleteCall[1]).toEqual([TEST_ID, TEST_TENANT]);
    });
  });

  describe('default prepareInsertParams', () => {
    it('returns [id, tenantId, userPhone] by default', () => {
      class MinimalService extends BaseCRUDService {
        constructor() { super('Minimal', QUERIES); }
      }
      const svc = new MinimalService();
      const result = svc.prepareInsertParams('id-1', {}, 'tenant-1', 'user@x.com');
      expect(result).toEqual(['id-1', 'tenant-1', 'user@x.com']);
    });
  });

  describe('default prepareUpdateParams', () => {
    it('returns [userPhone, id, tenantId] by default', () => {
      class MinimalService extends BaseCRUDService {
        constructor() { super('Minimal', QUERIES); }
      }
      const svc = new MinimalService();
      const result = svc.prepareUpdateParams({}, {}, 'user@x.com', 'id-1', 'tenant-1');
      expect(result).toEqual(['user@x.com', 'id-1', 'tenant-1']);
    });
  });
});
