// src/__tests__/middleware/setupGate.test.js
// Unit tests for the first-time tenancy setup gate.
//
// The single most important behaviour here is the backward-compatibility rule:
// a token WITHOUT a `setupCompleted` claim must pass. Every token issued before
// this feature shipped, and every fixture in the existing test suite, is in that
// shape — if the gate blocked them it would lock out live sessions on deploy.

jest.mock('jsonwebtoken', () => ({ verify: jest.fn() }));
jest.mock('../../config/envConfig', () => ({ JWT_SECRET: 'test-secret' }));
jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock('../../modules/mastersetup/mastersetup.repository', () => ({
  isSetupComplete: jest.fn(),
}));

const jwt = require('jsonwebtoken');
const { requireTenantSetup, isAllowedPath } = require('../../middleware/setupGate');
const setupRepository = require('../../modules/mastersetup/mastersetup.repository');
const { HttpError } = require('../../middleware/errorHandler');
const { TENANT_SETUP, SCOPES } = require('../../config/constants');

const TENANT = 'tenant-1';

// A token payload for a provisioned user whose tenant has NOT been set up.
const gatedUser = (overrides = {}) => ({
  tid: TENANT,
  email: 'user@test.com',
  scopes: ['MASTER_DATA:READ'],
  setupCompleted: false,
  ...overrides,
});

describe('isAllowedPath', () => {
  it('allows the API index', () => {
    expect(isAllowedPath('/')).toBe(true);
  });

  it.each([
    '/api/auth/google',
    '/api/onboarding/status',
    '/api/user/logout',
    '/api/audit',
    '/api/audit/logs',
    '/api/master-data/bootstrap',
    '/api/master-data/status',
    '/api/tenants',
    '/api/admin/app-config',
  ])('allows %s', (path) => {
    expect(isAllowedPath(path)).toBe(true);
  });

  it.each([
    '/api/categories',
    '/api/itemdetails',
    '/api/pos/orders',
    '/api/admin/users',
  ])('blocks %s', (path) => {
    expect(isAllowedPath(path)).toBe(false);
  });

  it('does not treat a prefix as a match on a longer sibling segment', () => {
    // '/api/users' must not be allowed just because '/api/user' is a prefix.
    expect(isAllowedPath('/api/users')).toBe(false);
  });
});

describe('requireTenantSetup', () => {
  let req, res, next;

  beforeEach(() => {
    jest.clearAllMocks();
    req = { path: '/api/categories', headers: { authorization: 'Bearer tok' } };
    res = {};
    next = jest.fn();
    jwt.verify.mockReturnValue(gatedUser());
    setupRepository.isSetupComplete.mockResolvedValue(false);
  });

  const expectPassed = () => {
    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith();
  };

  const expectBlocked = () => {
    expect(next).toHaveBeenCalledTimes(1);
    const err = next.mock.calls[0][0];
    expect(err).toBeInstanceOf(HttpError);
    expect(err.statusCode).toBe(403);
    expect(err.code).toBe(TENANT_SETUP.ERROR_CODE);
  };

  it('blocks a gated user on a non-allowlisted path', async () => {
    await requireTenantSetup(req, res, next);
    expectBlocked();
  });

  it('lets a gated user through on an allowlisted path', async () => {
    req.path = '/api/master-data/bootstrap';
    await requireTenantSetup(req, res, next);
    expectPassed();
    // Allowlist short-circuits before any token or DB work.
    expect(jwt.verify).not.toHaveBeenCalled();
    expect(setupRepository.isSetupComplete).not.toHaveBeenCalled();
  });

  it('lets a gated user reach the audit log', async () => {
    req.path = '/api/audit';
    await requireTenantSetup(req, res, next);
    expectPassed();
  });

  it('passes unauthenticated requests to the route to answer', async () => {
    req.headers = {};
    await requireTenantSetup(req, res, next);
    // The gate never invents auth errors — authenticateToken owns 401/403.
    expectPassed();
  });

  it('passes requests whose token cannot be verified', async () => {
    jwt.verify.mockImplementation(() => {
      throw new Error('bad token');
    });
    await requireTenantSetup(req, res, next);
    expectPassed();
  });

  // ── The backward-compatibility contract ────────────────────────────────────
  it('passes a token with NO setupCompleted claim', async () => {
    const { setupCompleted, ...noClaim } = gatedUser();
    jwt.verify.mockReturnValue(noClaim);

    await requireTenantSetup(req, res, next);

    expectPassed();
    // Never even consults the database for a claimless token.
    expect(setupRepository.isSetupComplete).not.toHaveBeenCalled();
  });

  it('passes a token with setupCompleted: true without touching the database', async () => {
    jwt.verify.mockReturnValue(gatedUser({ setupCompleted: true }));
    await requireTenantSetup(req, res, next);
    expectPassed();
    expect(setupRepository.isSetupComplete).not.toHaveBeenCalled();
  });

  it('exempts super admins', async () => {
    jwt.verify.mockReturnValue(
      gatedUser({ scopes: [SCOPES.TENANT_SUPER_ADMIN] })
    );
    await requireTenantSetup(req, res, next);
    expectPassed();
    expect(setupRepository.isSetupComplete).not.toHaveBeenCalled();
  });

  it('passes guest tokens (no tenant to set up)', async () => {
    jwt.verify.mockReturnValue(gatedUser({ tid: null, scopes: ['guest:explore'] }));
    await requireTenantSetup(req, res, next);
    expectPassed();
  });

  it('passes a stale token when the database says setup is now complete', async () => {
    // User finished the wizard but is still holding the pre-wizard token.
    setupRepository.isSetupComplete.mockResolvedValue(true);
    await requireTenantSetup(req, res, next);
    expectPassed();
    expect(setupRepository.isSetupComplete).toHaveBeenCalledWith(TENANT);
  });

  it('tolerates a token with no scopes array', async () => {
    jwt.verify.mockReturnValue(gatedUser({ scopes: undefined }));
    await requireTenantSetup(req, res, next);
    expectBlocked();
  });

  it('forwards an unexpected repository error instead of failing open', async () => {
    const boom = new Error('db down');
    setupRepository.isSetupComplete.mockRejectedValue(boom);
    await requireTenantSetup(req, res, next);
    expect(next).toHaveBeenCalledWith(boom);
  });
});
