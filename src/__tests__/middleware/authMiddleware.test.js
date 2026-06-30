// src/__tests__/middleware/authMiddleware.test.js

jest.mock('jsonwebtoken', () => ({ verify: jest.fn() }));
jest.mock('../../config/envConfig', () => ({ JWT_SECRET: 'test-secret' }));
jest.mock('../../config/messages', () => ({
  HTTP_HEADER: { AUTHORIZATION: 'authorization', BEARER_SPLIT_INDEX: 1 },
  ERROR: {
    INVALID_TOKEN: 'Invalid or missing token.',
    INVALID_TOKEN_PAYLOAD: 'Invalid token payload.',
    FORBIDDEN_NO_SCOPES: 'No scopes for tenant ',
    FORBIDDEN_MISSING_SCOPE: 'Missing required scope: ',
    FORBIDDEN_GUEST_SCOPE: 'Guest access required.',
  },
  HTTP_STATUS: { UNAUTHORIZED: 401, FORBIDDEN: 403 },
}));
jest.mock('../../config/constants', () => ({
  SCOPES: { TENANT_SUPER_ADMIN: 'TENANT:SUPER_ADMIN', GUEST_EXPLORE: 'guest:explore' },
}));
jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const jwt = require('jsonwebtoken');
const { authenticateToken, checkScope, checkGuestScope } = require('../../middleware/authMiddleware');
const { HttpError } = require('../../middleware/errorHandler');

describe('authenticateToken', () => {
  let req, res, next;

  beforeEach(() => {
    jest.clearAllMocks();
    req = { headers: {} };
    res = {};
    next = jest.fn();
  });

  it('calls next(HttpError 401) when no authorization header', () => {
    authenticateToken(req, res, next);
    expect(next).toHaveBeenCalledWith(expect.any(HttpError));
    expect(next.mock.calls[0][0].statusCode).toBe(401);
  });

  it('calls next(HttpError 401) when authorization header has no token', () => {
    req.headers.authorization = 'Bearer ';
    // token will be empty string — falsy
    authenticateToken(req, res, next);
    expect(next).toHaveBeenCalledWith(expect.any(HttpError));
  });

  it('calls next(HttpError 403) when jwt.verify throws', () => {
    req.headers.authorization = 'Bearer badtoken';
    jwt.verify.mockImplementation(() => { throw new Error('bad'); });
    authenticateToken(req, res, next);
    expect(next).toHaveBeenCalledWith(expect.any(HttpError));
    expect(next.mock.calls[0][0].statusCode).toBe(403);
  });

  it('calls next(HttpError 403) when token payload is missing tid', () => {
    req.headers.authorization = 'Bearer goodtoken';
    jwt.verify.mockReturnValue({ scopes: ['TENANT:ADMIN'] }); // tid is undefined
    authenticateToken(req, res, next);
    expect(next).toHaveBeenCalledWith(expect.any(HttpError));
    expect(next.mock.calls[0][0].statusCode).toBe(403);
  });

  it('allows null tid (guest token) to pass authenticateToken', () => {
    req.headers.authorization = 'Bearer guesttoken';
    const mockGuest = { tid: null, email: 'guest@test.com', scopes: ['guest:explore'] };
    jwt.verify.mockReturnValue(mockGuest);
    authenticateToken(req, res, next);
    expect(req.user).toEqual(mockGuest);
    expect(next).toHaveBeenCalledWith();
  });

  it('calls next(HttpError 403) when token payload scopes is not an array', () => {
    req.headers.authorization = 'Bearer goodtoken';
    jwt.verify.mockReturnValue({ tid: 'tenant-id', scopes: 'TENANT:ADMIN' }); // not array
    authenticateToken(req, res, next);
    expect(next).toHaveBeenCalledWith(expect.any(HttpError));
    expect(next.mock.calls[0][0].statusCode).toBe(403);
  });

  it('sets req.user and calls next() on valid token', () => {
    req.headers.authorization = 'Bearer validtoken';
    const mockUser = { tid: 'tenant-id', email: 'user@test.com', scopes: ['TENANT:ADMIN'] };
    jwt.verify.mockReturnValue(mockUser);
    authenticateToken(req, res, next);
    expect(req.user).toEqual(mockUser);
    expect(next).toHaveBeenCalledWith(); // no args = success
  });
});

describe('checkScope', () => {
  let req, res, next;

  beforeEach(() => {
    jest.clearAllMocks();
    res = {};
    next = jest.fn();
  });

  it('calls next(HttpError) when user has no scopes', () => {
    req = { user: { tid: 'tid', scopes: [] } };
    checkScope('TENANT:ADMIN')(req, res, next);
    expect(next).toHaveBeenCalledWith(expect.any(HttpError));
  });

  it('calls next(HttpError) when user scopes is undefined', () => {
    req = { user: { tid: 'tid' } };
    checkScope('TENANT:ADMIN')(req, res, next);
    expect(next).toHaveBeenCalledWith(expect.any(HttpError));
  });

  it('calls next() when user has TENANT:SUPER_ADMIN (bypass)', () => {
    req = { user: { tid: 'tid', scopes: ['TENANT:SUPER_ADMIN'] } };
    checkScope('TENANT:ADMIN')(req, res, next);
    expect(next).toHaveBeenCalledWith();
  });

  it('calls next() when user has the required scope', () => {
    req = { user: { tid: 'tid', scopes: ['TENANT:ADMIN'] } };
    checkScope('TENANT:ADMIN')(req, res, next);
    expect(next).toHaveBeenCalledWith();
  });

  it('calls next(HttpError) when user is missing required scope', () => {
    req = { user: { tid: 'tid', scopes: ['TENANT:VIEWER'] } };
    checkScope('TENANT:ADMIN')(req, res, next);
    expect(next).toHaveBeenCalledWith(expect.any(HttpError));
  });

  it('allows access if user has at least one of multiple required scopes', () => {
    req = { user: { tid: 'tid', scopes: ['TENANT:MANAGER'] } };
    checkScope('TENANT:ADMIN', 'TENANT:MANAGER')(req, res, next);
    expect(next).toHaveBeenCalledWith();
  });
});

describe('checkGuestScope', () => {
  let req, res, next;

  beforeEach(() => {
    jest.clearAllMocks();
    res = {};
    next = jest.fn();
  });

  it('calls next(HttpError 403) when user has no scopes', () => {
    req = { user: { tid: null, scopes: [] } };
    checkGuestScope(req, res, next);
    expect(next).toHaveBeenCalledWith(expect.any(HttpError));
    expect(next.mock.calls[0][0].statusCode).toBe(403);
  });

  it('calls next(HttpError 403) when user scopes does not include guest:explore', () => {
    req = { user: { tid: 'tid', scopes: ['TENANT:ADMIN'] } };
    checkGuestScope(req, res, next);
    expect(next).toHaveBeenCalledWith(expect.any(HttpError));
  });

  it('calls next() when user has guest:explore scope', () => {
    req = { user: { tid: null, scopes: ['guest:explore'] } };
    checkGuestScope(req, res, next);
    expect(next).toHaveBeenCalledWith();
  });

  it('calls next(HttpError 403) when req.user is undefined', () => {
    req = {};
    checkGuestScope(req, res, next);
    expect(next).toHaveBeenCalledWith(expect.any(HttpError));
  });
});
