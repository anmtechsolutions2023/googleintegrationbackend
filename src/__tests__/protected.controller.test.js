// src/__tests__/protected.controller.test.js
// Mock the service
jest.mock('../services/protected.service', () => ({
  switchTenantPermissions: jest.fn(),
  getUserTenants: jest.fn(),
  getAuditLogs: jest.fn(),
}))
jest.mock('../services/auth.service', () => ({
  generateAppToken: jest.fn(),
}))
jest.mock('../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}))
jest.mock('../config/messages', () => ({
  SUCCESS: {
    TENANT_SWITCH: 'Successfully switched to tenant ',
    AUDIT_LOGS_RETRIEVED: 'Audit logs retrieved',
    GENERAL_ACCESS: 'General access granted',
    LOGOUT: 'Logged out successfully',
    ADMIN_ACCESS: 'Admin access granted',
    REPORTS_ACCESS: 'Reports access granted',
    BILLING_ACCESS: 'Billing access granted',
  },
  ERROR: {},
  INFO: {},
  HTTP_STATUS: {
    BAD_REQUEST: 400,
  },
}))

const protectedController = require('../controllers/protected.controller')
const protectedService = require('../services/protected.service')
const authService = require('../services/auth.service')
describe('Protected Controller', () => {
  let req, res, next

  beforeEach(() => {
    jest.clearAllMocks()
    req = {
      body: {},
      query: {},
      user: { id: 1, email: 'test@example.com', name: 'Test User', tid: '123' },
      ip: '127.0.0.1',
    }
    res = { json: jest.fn() }
    next = jest.fn()
  })

  test('switchTenant should validate and switch tenant', async () => {
    req.body = { tenantId: '123e4567-e89b-12d3-a456-426614174000' }
    const mockPermissions = {
      email: 'test@example.com',
      tenantId: '123',
      permissions: [],
    }
    const mockToken = 'new_jwt_token'

    protectedService.switchTenantPermissions.mockResolvedValue(mockPermissions)
    authService.generateAppToken.mockReturnValue(mockToken)

    await protectedController.switchTenant(req, res, next)

    expect(protectedService.switchTenantPermissions).toHaveBeenCalled()
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      message: expect.stringContaining('Successfully switched'),
      token: mockToken,
    })
  })

  test('getAuditLogs should retrieve logs', async () => {
    const mockLogs = [{ id: 1, action: 'login' }]
    protectedService.getUserTenants.mockResolvedValue([
      { tenant_id: '123', is_admin: 1 },
    ])
    protectedService.getAuditLogs.mockResolvedValue(mockLogs)

    await protectedController.getAuditLogs(req, res, next)

    expect(protectedService.getAuditLogs).toHaveBeenCalled()
    expect(res.json).toHaveBeenCalledWith({
      message: expect.any(String),
      logs: mockLogs,
      isAdmin: true,
      associatedTenants: expect.any(Array),
    })
  })
})
