// src/__tests__/middleware/validation.test.js
// Unit tests for validation middleware

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

const Joi = require('joi');
const {
  validateBody,
  validateQuery,
  validateParams,
  validateUuidParam,
  validateUuidParams,
} = require('../../middleware/validation');

const VALID_UUID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const INVALID_UUID = 'not-a-uuid';

const mockNext = () => jest.fn();
const mockRes = () => ({
  status: jest.fn().mockReturnThis(),
  json: jest.fn().mockReturnThis(),
});

describe('validation middleware', () => {
  describe('validateBody', () => {
    const schema = Joi.object({ name: Joi.string().required() });

    it('calls next() without error when body is valid', () => {
      const req = { body: { name: 'Widget' } };
      const res = mockRes();
      const next = mockNext();
      validateBody(schema)(req, res, next);
      expect(next).toHaveBeenCalledWith();
    });

    it('sets req.validatedBody on successful validation', () => {
      const req = { body: { name: 'Widget' } };
      validateBody(schema)(req, mockRes(), mockNext());
      expect(req.validatedBody).toEqual({ name: 'Widget' });
    });

    it('calls next(HttpError) when body is invalid', () => {
      const req = { body: {} };
      const next = mockNext();
      validateBody(schema)(req, mockRes(), next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
    });

    it('passes error message containing "Validation error:" on failure', () => {
      const req = { body: { name: 123 } };
      const next = mockNext();
      validateBody(schema)(req, mockRes(), next);
      const err = next.mock.calls[0][0];
      expect(err.message).toContain('Validation error:');
    });

    it('does not set req.validatedBody on failure', () => {
      const req = { body: {} };
      validateBody(schema)(req, mockRes(), mockNext());
      expect(req.validatedBody).toBeUndefined();
    });
  });

  describe('validateQuery', () => {
    const schema = Joi.object({ page: Joi.number().min(1), limit: Joi.number().min(1) });

    it('calls next() without error when query is valid', () => {
      const req = { query: { page: 1, limit: 10 } };
      const next = mockNext();
      validateQuery(schema)(req, mockRes(), next);
      expect(next).toHaveBeenCalledWith();
    });

    it('sets req.validatedQuery on successful validation', () => {
      const req = { query: { page: 2, limit: 5 } };
      validateQuery(schema)(req, mockRes(), mockNext());
      expect(req.validatedQuery).toEqual({ page: 2, limit: 5 });
    });

    it('calls next(HttpError) when query is invalid', () => {
      const schema2 = Joi.object({ page: Joi.number().min(1).required() });
      const req = { query: {} };
      const next = mockNext();
      validateQuery(schema2)(req, mockRes(), next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
    });

    it('calls next() with no args when empty query matches optional schema', () => {
      const req = { query: {} };
      const next = mockNext();
      validateQuery(schema)(req, mockRes(), next);
      expect(next).toHaveBeenCalledWith();
    });
  });

  describe('validateParams', () => {
    const schema = Joi.object({ id: Joi.string().required() });

    it('calls next() without error when params are valid', () => {
      const req = { params: { id: '123' } };
      const next = mockNext();
      validateParams(schema)(req, mockRes(), next);
      expect(next).toHaveBeenCalledWith();
    });

    it('sets req.validatedParams on successful validation', () => {
      const req = { params: { id: '123' } };
      validateParams(schema)(req, mockRes(), mockNext());
      expect(req.validatedParams).toEqual({ id: '123' });
    });

    it('calls next(HttpError) when params are invalid', () => {
      const req = { params: {} };
      const next = mockNext();
      validateParams(schema)(req, mockRes(), next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
    });

    it('error message contains "Validation error:" on failure', () => {
      const req = { params: {} };
      const next = mockNext();
      validateParams(schema)(req, mockRes(), next);
      expect(next.mock.calls[0][0].message).toContain('Validation error:');
    });
  });

  describe('validateUuidParam', () => {
    it('calls next() when param is a valid UUID', () => {
      const req = { params: { id: VALID_UUID } };
      const next = mockNext();
      validateUuidParam('id')(req, mockRes(), next);
      expect(next).toHaveBeenCalledWith();
    });

    it('calls next(HttpError) when param is not a valid UUID', () => {
      const req = { params: { id: INVALID_UUID } };
      const next = mockNext();
      validateUuidParam('id')(req, mockRes(), next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
    });

    it('calls next(HttpError) when param is missing', () => {
      const req = { params: {} };
      const next = mockNext();
      validateUuidParam('id')(req, mockRes(), next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
    });

    it('validates the named param correctly', () => {
      const req = { params: { userId: VALID_UUID } };
      const next = mockNext();
      validateUuidParam('userId')(req, mockRes(), next);
      expect(next).toHaveBeenCalledWith();
    });

    it('rejects when wrong param name is present', () => {
      const req = { params: { otherId: VALID_UUID } };
      const next = mockNext();
      validateUuidParam('id')(req, mockRes(), next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
    });
  });

  describe('validateUuidParams', () => {
    it('calls next() when all params are valid UUIDs', () => {
      const req = { params: { userId: VALID_UUID, itemId: VALID_UUID } };
      const next = mockNext();
      validateUuidParams('userId', 'itemId')(req, mockRes(), next);
      expect(next).toHaveBeenCalledWith();
    });

    it('calls next(HttpError) when one param is invalid', () => {
      const req = { params: { userId: VALID_UUID, itemId: INVALID_UUID } };
      const next = mockNext();
      validateUuidParams('userId', 'itemId')(req, mockRes(), next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
    });

    it('calls next(HttpError) when a param is missing', () => {
      const req = { params: { userId: VALID_UUID } };
      const next = mockNext();
      validateUuidParams('userId', 'itemId')(req, mockRes(), next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
    });

    it('works with a single param name', () => {
      const req = { params: { id: VALID_UUID } };
      const next = mockNext();
      validateUuidParams('id')(req, mockRes(), next);
      expect(next).toHaveBeenCalledWith();
    });

    it('rejects empty params when multiple are required', () => {
      const req = { params: {} };
      const next = mockNext();
      validateUuidParams('a', 'b')(req, mockRes(), next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
    });
  });
});
