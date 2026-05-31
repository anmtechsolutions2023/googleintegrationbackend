// src/__tests__/middleware/errorHandler.test.js
// Unit tests for the global error handling middleware and HttpError class

jest.mock('../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
  captureAudit: jest.fn(),
}));

const { errorHandler, HttpError } = require('../../middleware/errorHandler');

const mockRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

const mockReq = () => ({});
const mockNext = () => jest.fn();

describe('errorHandler middleware', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('HttpError class', () => {
    it('creates an error with message and statusCode', () => {
      const err = new HttpError('Not found', 404);
      expect(err.message).toBe('Not found');
      expect(err.statusCode).toBe(404);
    });

    it('is an instance of Error', () => {
      const err = new HttpError('Bad request', 400);
      expect(err).toBeInstanceOf(Error);
    });

    it('supports different status codes', () => {
      expect(new HttpError('Forbidden', 403).statusCode).toBe(403);
      expect(new HttpError('Server error', 500).statusCode).toBe(500);
    });
  });

  describe('ER_DUP_ENTRY MySQL error', () => {
    it('returns 409 with DUPLICATE_ENTRY error code', () => {
      const err = { code: 'ER_DUP_ENTRY', message: "Duplicate entry for key 'PRIMARY'" };
      const res = mockRes();
      errorHandler(err, mockReq(), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'DUPLICATE_ENTRY', success: false })
      );
    });

    it('also handles errno 1062', () => {
      const err = { errno: 1062, message: "Duplicate entry for key 'uk_contact_name_mobile'" };
      const res = mockRes();
      errorHandler(err, mockReq(), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(409);
    });

    it('uses friendly message for uk_contact_name_mobile constraint', () => {
      const err = {
        code: 'ER_DUP_ENTRY',
        message: "Duplicate entry for key 'mydb.uk_contact_name_mobile'",
      };
      const res = mockRes();
      errorHandler(err, mockReq(), res, mockNext());
      const payload = res.json.mock.calls[0][0];
      expect(payload.message).toBe(
        'A contact with this FirstName, LastName and MobileNo combination already exists.'
      );
    });

    it('uses friendly message for uk_mplm_tagname constraint', () => {
      const err = {
        code: 'ER_DUP_ENTRY',
        message: "Duplicate entry for key 'mydb.uk_mplm_tagname'",
      };
      const res = mockRes();
      errorHandler(err, mockReq(), res, mockNext());
      const payload = res.json.mock.calls[0][0];
      expect(payload.message).toContain('map provider location mapper');
    });

    it('uses generic message for unknown constraint key', () => {
      const err = {
        code: 'ER_DUP_ENTRY',
        message: "Duplicate entry for key 'mydb.uk_some_unknown_key'",
      };
      const res = mockRes();
      errorHandler(err, mockReq(), res, mockNext());
      const payload = res.json.mock.calls[0][0];
      expect(payload.message).toContain('already exists');
    });

    it('uses generic message when no key info in message', () => {
      const err = { code: 'ER_DUP_ENTRY', message: 'Duplicate entry' };
      const res = mockRes();
      errorHandler(err, mockReq(), res, mockNext());
      const payload = res.json.mock.calls[0][0];
      expect(payload.message).toContain('already exists');
    });
  });

  describe('ER_ROW_IS_REFERENCED_2 MySQL error', () => {
    it('returns 409 with RESOURCE_IN_USE error code', () => {
      const err = {
        code: 'ER_ROW_IS_REFERENCED_2',
        message: 'Foreign key constraint fails',
        sqlMessage:
          "Cannot delete or update a parent row: a foreign key constraint fails (`mydb`.`child_table`, CONSTRAINT `fk_name` FOREIGN KEY (`ParentId`) REFERENCES `parent_table` (`Id`))",
      };
      const res = mockRes();
      errorHandler(err, mockReq(), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'RESOURCE_IN_USE', success: false })
      );
    });

    it('also handles errno 1451', () => {
      const err = { errno: 1451, message: 'FK constraint' };
      const res = mockRes();
      errorHandler(err, mockReq(), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(409);
    });

    it('includes "Cannot delete resource" in message', () => {
      const err = { code: 'ER_ROW_IS_REFERENCED_2', message: 'FK fail' };
      const res = mockRes();
      errorHandler(err, mockReq(), res, mockNext());
      const payload = res.json.mock.calls[0][0];
      expect(payload.message).toContain('Cannot delete resource');
    });

    it('parses referencingTable and referencingColumn from sqlMessage', () => {
      const err = {
        code: 'ER_ROW_IS_REFERENCED_2',
        sqlMessage:
          "Cannot delete or update a parent row: (`mydb`.`order_items`, CONSTRAINT `fk_order_item` FOREIGN KEY (`OrderId`) REFERENCES `orders` (`Id`))",
      };
      const res = mockRes();
      errorHandler(err, mockReq(), res, mockNext());
      const payload = res.json.mock.calls[0][0];
      expect(payload.details).toBeDefined();
    });

    it('sets referencingTable null when sqlMessage is absent', () => {
      const err = { code: 'ER_ROW_IS_REFERENCED_2' };
      const res = mockRes();
      errorHandler(err, mockReq(), res, mockNext());
      const payload = res.json.mock.calls[0][0];
      expect(payload.details.referencingTable).toBeNull();
    });
  });

  describe('HttpError (application errors)', () => {
    it('returns the HttpError statusCode and message', () => {
      const err = new HttpError('Resource not found', 404);
      const res = mockRes();
      errorHandler(err, mockReq(), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Resource not found', success: false })
      );
    });

    it('returns 400 with validation error message', () => {
      const err = new HttpError('Validation error: name is required', 400);
      const res = mockRes();
      errorHandler(err, mockReq(), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Validation error: name is required' })
      );
    });

    it('returns 403 for forbidden errors', () => {
      const err = new HttpError('Forbidden', 403);
      const res = mockRes();
      errorHandler(err, mockReq(), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(403);
    });
  });

  describe('generic (unknown) errors', () => {
    it('returns 500 with "Internal Server Error" message', () => {
      const err = new Error('Unexpected failure');
      const res = mockRes();
      errorHandler(err, mockReq(), res, mockNext());
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Internal Server Error', success: false })
      );
    });

    it('returns success: false for generic errors', () => {
      const err = new Error('Something broke');
      const res = mockRes();
      errorHandler(err, mockReq(), res, mockNext());
      const payload = res.json.mock.calls[0][0];
      expect(payload.success).toBe(false);
    });

    it('does not expose internal error message to client for 500 errors', () => {
      const err = new Error('SQL syntax error near...');
      const res = mockRes();
      errorHandler(err, mockReq(), res, mockNext());
      const payload = res.json.mock.calls[0][0];
      expect(payload.message).not.toBe('SQL syntax error near...');
      expect(payload.message).toBe('Internal Server Error');
    });
  });
});
