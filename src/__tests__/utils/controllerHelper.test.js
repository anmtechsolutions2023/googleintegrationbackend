// src/__tests__/utils/controllerHelper.test.js
// Unit tests for controller helper utilities

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

const {
  asyncHandler,
  extractUserContext,
  validateRequest,
  logAction,
  logSuccess,
  logError,
} = require('../../utils/controllerHelper');
const { logger } = require('../../utils/logger');
const { HttpError } = require('../../middleware/errorHandler');

describe('controllerHelper', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('asyncHandler', () => {
    it('calls the wrapped function with req, res, next', async () => {
      const fn = jest.fn().mockResolvedValue('ok');
      const req = {};
      const res = {};
      const next = jest.fn();
      const wrapped = asyncHandler(fn);
      await wrapped(req, res, next);
      expect(fn).toHaveBeenCalledWith(req, res, next);
    });

    it('calls next with error when wrapped async function throws', async () => {
      const err = new Error('async failure');
      const fn = jest.fn().mockRejectedValue(err);
      const next = jest.fn();
      const wrapped = asyncHandler(fn);
      await wrapped({}, {}, next);
      expect(next).toHaveBeenCalledWith(err);
    });

    it('does not call next when wrapped function resolves successfully', async () => {
      const fn = jest.fn().mockResolvedValue('done');
      const next = jest.fn();
      const wrapped = asyncHandler(fn);
      await wrapped({}, {}, next);
      expect(next).not.toHaveBeenCalled();
    });

    it('returns a function', () => {
      const wrapped = asyncHandler(jest.fn());
      expect(typeof wrapped).toBe('function');
    });
  });

  describe('extractUserContext', () => {
    it('extracts tenantId, userEmail, and userName from req.user', () => {
      const req = {
        user: { tid: 'tenant-1', email: 'user@example.com', name: 'Test User' },
      };
      const ctx = extractUserContext(req);
      expect(ctx).toEqual({
        tenantId: 'tenant-1',
        userEmail: 'user@example.com',
        userName: 'Test User',
      });
    });

    it('falls back to email for userName when name is absent', () => {
      const req = {
        user: { tid: 'tenant-2', email: 'fallback@example.com' },
      };
      const ctx = extractUserContext(req);
      expect(ctx.userName).toBe('fallback@example.com');
    });

    it('maps tid to tenantId', () => {
      const req = { user: { tid: 'my-tenant', email: 'a@b.com', name: 'A' } };
      const ctx = extractUserContext(req);
      expect(ctx.tenantId).toBe('my-tenant');
    });
  });

  describe('validateRequest', () => {
    const Joi = require('joi');
    const schema = Joi.object({ name: Joi.string().required() });

    it('returns validated value on success', () => {
      const result = validateRequest(schema, { name: 'Widget' });
      expect(result).toEqual({ name: 'Widget' });
    });

    it('throws HttpError with status 400 on validation failure', () => {
      expect(() => validateRequest(schema, {})).toThrow(HttpError);
    });

    it('throws error with status 400 when field is missing', () => {
      try {
        validateRequest(schema, { wrongField: 'x' });
      } catch (err) {
        expect(err.statusCode).toBe(400);
      }
    });

    it('logs a warn message on validation failure', () => {
      try {
        validateRequest(schema, {}, 'TestContext');
      } catch (_) {
        // swallow
      }
      expect(logger.warn).toHaveBeenCalled();
    });

    it('error message contains "Validation error:"', () => {
      try {
        validateRequest(schema, {});
      } catch (err) {
        expect(err.message).toContain('Validation error:');
      }
    });
  });

  describe('logAction', () => {
    it('calls logger.info with action name', () => {
      logAction('GetAll');
      expect(logger.info).toHaveBeenCalledWith('GetAll', {});
    });

    it('passes context object to logger.info', () => {
      logAction('Create', { tenantId: 't1' });
      expect(logger.info).toHaveBeenCalledWith('Create', { tenantId: 't1' });
    });

    it('defaults context to empty object', () => {
      logAction('Delete');
      expect(logger.info).toHaveBeenCalledWith('Delete', {});
    });
  });

  describe('logSuccess', () => {
    it('calls logger.info with action + " - Success"', () => {
      logSuccess('Create');
      expect(logger.info).toHaveBeenCalledWith('Create - Success', {});
    });

    it('passes context object to logger.info', () => {
      logSuccess('Update', { id: '123' });
      expect(logger.info).toHaveBeenCalledWith('Update - Success', { id: '123' });
    });
  });

  describe('logError', () => {
    it('calls logger.error with action + " - Error" and the error', () => {
      const err = new Error('db fail');
      logError('Delete', err);
      expect(logger.error).toHaveBeenCalledWith('Delete - Error', err);
    });
  });
});
