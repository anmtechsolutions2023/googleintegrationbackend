// src/__tests__/utils/dbHelper.test.js
// Unit tests for dbHelper utility functions

jest.mock('../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
  captureAudit: jest.fn(),
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

const mockConnection = {
  execute: jest.fn(),
  query: jest.fn(),
  release: jest.fn(),
  beginTransaction: jest.fn(),
  commit: jest.fn(),
  rollback: jest.fn(),
};

const mockGetConnection = jest.fn().mockResolvedValue(mockConnection);
jest.mock('../../config/db', () => ({
  getConnection: mockGetConnection,
}));

const { withConnection, withTransaction, findOneOrFail, findAll, executeQuery } =
  require('../../utils/dbHelper');
const { HttpError } = require('../../middleware/errorHandler');

describe('dbHelper', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetConnection.mockResolvedValue(mockConnection);
    mockConnection.release.mockResolvedValue(undefined);
    mockConnection.beginTransaction.mockResolvedValue(undefined);
    mockConnection.commit.mockResolvedValue(undefined);
    mockConnection.rollback.mockResolvedValue(undefined);
  });

  describe('withConnection', () => {
    it('calls callback with the connection and returns result', async () => {
      const cb = jest.fn().mockResolvedValue('result');
      const result = await withConnection(cb);
      expect(cb).toHaveBeenCalledWith(mockConnection);
      expect(result).toBe('result');
    });

    it('releases connection after successful callback', async () => {
      await withConnection(jest.fn().mockResolvedValue('ok'));
      expect(mockConnection.release).toHaveBeenCalled();
    });

    it('releases connection even when callback throws', async () => {
      const cb = jest.fn().mockRejectedValue(new Error('fail'));
      await expect(withConnection(cb)).rejects.toThrow('fail');
      expect(mockConnection.release).toHaveBeenCalled();
    });

    it('propagates the error from callback', async () => {
      const err = new Error('db error');
      await expect(withConnection(jest.fn().mockRejectedValue(err))).rejects.toThrow('db error');
    });
  });

  describe('withTransaction', () => {
    it('begins transaction, calls callback, commits, and releases', async () => {
      const cb = jest.fn().mockResolvedValue('txResult');
      const result = await withTransaction(cb);
      expect(mockConnection.beginTransaction).toHaveBeenCalled();
      expect(cb).toHaveBeenCalledWith(mockConnection);
      expect(mockConnection.commit).toHaveBeenCalled();
      expect(mockConnection.release).toHaveBeenCalled();
      expect(result).toBe('txResult');
    });

    it('rolls back and releases when callback throws', async () => {
      const err = new Error('tx fail');
      const cb = jest.fn().mockRejectedValue(err);
      await expect(withTransaction(cb)).rejects.toThrow('tx fail');
      expect(mockConnection.rollback).toHaveBeenCalled();
      expect(mockConnection.release).toHaveBeenCalled();
    });

    it('does not commit when callback throws', async () => {
      const cb = jest.fn().mockRejectedValue(new Error('fail'));
      await expect(withTransaction(cb)).rejects.toThrow();
      expect(mockConnection.commit).not.toHaveBeenCalled();
    });

    it('does not rollback on success', async () => {
      await withTransaction(jest.fn().mockResolvedValue('ok'));
      expect(mockConnection.rollback).not.toHaveBeenCalled();
    });
  });

  describe('findOneOrFail', () => {
    it('returns first row when record is found', async () => {
      const row = { Id: '1', Name: 'Test' };
      mockConnection.execute.mockResolvedValue([[row]]);
      const result = await findOneOrFail('SELECT * FROM items WHERE Id = ?', ['1'], 'Item');
      expect(result).toEqual(row);
    });

    it('throws HttpError with 404 when no rows returned', async () => {
      mockConnection.execute.mockResolvedValue([[]]);
      await expect(
        findOneOrFail('SELECT * FROM items WHERE Id = ?', ['missing'], 'Item')
      ).rejects.toThrow(HttpError);
    });

    it('throws error with status 404 when not found', async () => {
      mockConnection.execute.mockResolvedValue([[]]);
      try {
        await findOneOrFail('SELECT * FROM x WHERE Id = ?', ['x'], 'Widget');
      } catch (err) {
        expect(err.statusCode).toBe(404);
      }
    });

    it('throws error with message containing entityName when not found', async () => {
      mockConnection.execute.mockResolvedValue([[]]);
      try {
        await findOneOrFail('SELECT * FROM x WHERE Id = ?', ['x'], 'SpecialEntity');
      } catch (err) {
        expect(err.message).toContain('SpecialEntity');
      }
    });

    it('passes query and params to connection.execute', async () => {
      const row = { Id: '1' };
      mockConnection.execute.mockResolvedValue([[row]]);
      await findOneOrFail('SELECT * FROM t WHERE Id = ?', ['1'], 'T');
      expect(mockConnection.execute).toHaveBeenCalledWith(
        'SELECT * FROM t WHERE Id = ?',
        ['1']
      );
    });
  });

  describe('findAll', () => {
    it('returns all rows from query', async () => {
      const rows = [{ Id: '1' }, { Id: '2' }];
      mockConnection.execute.mockResolvedValue([rows]);
      const result = await findAll('SELECT * FROM items WHERE TenantId = ?', ['t1']);
      expect(result).toEqual(rows);
    });

    it('returns empty array when no rows found', async () => {
      mockConnection.execute.mockResolvedValue([[]]);
      const result = await findAll('SELECT * FROM items WHERE TenantId = ?', ['t1']);
      expect(result).toEqual([]);
    });

    it('defaults params to empty array', async () => {
      mockConnection.execute.mockResolvedValue([[]]);
      await findAll('SELECT * FROM items');
      expect(mockConnection.execute).toHaveBeenCalledWith('SELECT * FROM items', []);
    });
  });

  describe('executeQuery', () => {
    it('returns query result for insert/update/delete', async () => {
      const result = { affectedRows: 1 };
      mockConnection.execute.mockResolvedValue([result]);
      const output = await executeQuery('DELETE FROM items WHERE Id = ?', ['1']);
      expect(output).toEqual(result);
    });

    it('defaults params to empty array', async () => {
      mockConnection.execute.mockResolvedValue([{ affectedRows: 0 }]);
      await executeQuery('DELETE FROM items WHERE Id = 1');
      expect(mockConnection.execute).toHaveBeenCalledWith(
        'DELETE FROM items WHERE Id = 1',
        []
      );
    });

    it('passes query and params to connection.execute', async () => {
      mockConnection.execute.mockResolvedValue([{ affectedRows: 1 }]);
      await executeQuery('UPDATE items SET Name = ? WHERE Id = ?', ['NewName', '1']);
      expect(mockConnection.execute).toHaveBeenCalledWith(
        'UPDATE items SET Name = ? WHERE Id = ?',
        ['NewName', '1']
      );
    });
  });
});
