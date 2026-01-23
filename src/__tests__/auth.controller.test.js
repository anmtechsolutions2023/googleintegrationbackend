// src/__tests__/auth.controller.test.js
// Mock the service
jest.mock('../modules/auth/auth.service', () => ({
  validateGoogleToken: jest.fn(),
  findAndGetPermissions: jest.fn(),
  generateAppToken: jest.fn(),
}));
jest.mock('../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
  captureAudit: jest.fn(),
}));
jest.mock('../config/messages', () => ({
  SUCCESS: {
    AUTH: 'Authentication successful',
  },
  ERROR: {},
  INFO: {},
  HTTP_STATUS: {
    UNAUTHORIZED: 401,
    BAD_REQUEST: 400,
  },
}));

const authController = require('../modules/auth/auth.controller');
const authService = require('../modules/auth/auth.service');

describe('Auth Controller', () => {
  let req, res, next;

  beforeEach(() => {
    jest.clearAllMocks();
    req = { body: {}, ip: '127.0.0.1' };
    res = { json: jest.fn() };
    next = jest.fn();
  });

  test('googleAuth should validate and authenticate user', async () => {
    req.body = { id_token: 'valid_token' };
    const mockUser = { email: 'test@example.com', name: 'Test User' };
    const mockPermissions = {
      email: 'test@example.com',
      tenantId: '123',
      permissions: [],
    };
    const mockToken = 'jwt_token';

    authService.validateGoogleToken.mockResolvedValue(mockUser);
    authService.findAndGetPermissions.mockResolvedValue(mockPermissions);
    authService.generateAppToken.mockReturnValue(mockToken);

    await authController.googleAuth(req, res, next);

    expect(authService.validateGoogleToken).toHaveBeenCalledWith('valid_token');
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      message: expect.any(String),
      token: mockToken,
      user: expect.objectContaining({ email: 'test@example.com' }),
    });
  });

  test('googleAuth should handle validation error', async () => {
    req.body = {}; // Missing id_token

    await authController.googleAuth(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });
});
