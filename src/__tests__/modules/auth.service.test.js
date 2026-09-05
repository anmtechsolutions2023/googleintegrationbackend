// src/__tests__/auth.service.test.js

// envConfig reads real environment variables, which are absent under test, so
// jwt.sign would get an undefined secret. Pin one.
jest.mock('../../config/envConfig', () => ({
  ...jest.requireActual('../../config/envConfig'),
  JWT_SECRET: 'auth-service-test-secret',
}));

const jwt = require('jsonwebtoken');
const {
  validateGoogleToken,
  generateAppToken,
  reissueTokenWithSetupComplete,
} = require('../../modules/auth/auth.service');
const { JWT_SECRET } = require('../../config/envConfig');

describe('Auth Service', () => {
  test('validateGoogleToken should throw for invalid token', async () => {
    await expect(validateGoogleToken('invalid')).rejects.toThrow();
  });
});

// ─── First-time setup claim ──────────────────────────────────────────────────
describe('generateAppToken — setupCompleted claim', () => {
  const approved = (overrides = {}) => ({
    phone: '+919876504011',
    name: 'User',
    tenantId: 'tenant-1',
    onboardingStatus: 'APPROVED',
    permissions: ['MASTER_DATA:READ'],
    roles: [],
    associatedTenants: [],
    ...overrides,
  });

  const decode = (payload) => jwt.verify(generateAppToken(payload), JWT_SECRET);

  it('writes setupCompleted: false for a tenant that has not run the wizard', () => {
    expect(decode(approved({ setupCompleted: false })).setupCompleted).toBe(false);
  });

  it('writes setupCompleted: true for a tenant that has', () => {
    expect(decode(approved({ setupCompleted: true })).setupCompleted).toBe(true);
  });

  it('omits the claim entirely when the caller did not resolve it', () => {
    // Absent rather than false: the gate treats a missing claim as "pass", so
    // an unresolved value must never accidentally lock a user out.
    expect('setupCompleted' in decode(approved())).toBe(false);
  });

  it('omits the claim for guest tokens (no tenant to set up)', () => {
    const guest = decode({
      phone: '+919876504011',
      name: 'Guest',
      tenantId: null,
      onboardingStatus: 'PENDING',
      permissions: ['guest:explore'],
      setupCompleted: false,
    });
    expect('setupCompleted' in guest).toBe(false);
  });
});

describe('reissueTokenWithSetupComplete', () => {
  const original = {
    phone: '+919876504011',
    name: 'Admin',
    tid: 'tenant-1',
    scopes: ['TENANT:ADMIN'],
    roles: ['TENANT_ADMIN'],
    onboardingStatus: 'APPROVED',
    associatedTenants: [{ tenantId: 'tenant-1', isAdmin: true }],
    setupCompleted: false,
    iat: 1000,
    exp: 2000,
  };

  it('flips setupCompleted to true', () => {
    const claims = jwt.verify(reissueTokenWithSetupComplete(original), JWT_SECRET);
    expect(claims.setupCompleted).toBe(true);
  });

  it('carries identity, scopes and roles over verbatim — nothing is elevated', () => {
    const claims = jwt.verify(reissueTokenWithSetupComplete(original), JWT_SECRET);
    expect(claims.phone).toBe('+919876504011');
    expect(claims.tid).toBe('tenant-1');
    expect(claims.scopes).toEqual(['TENANT:ADMIN']);
    expect(claims.roles).toEqual(['TENANT_ADMIN']);
    expect(claims.associatedTenants).toEqual([{ tenantId: 'tenant-1', isAdmin: true }]);
  });

  it('issues fresh iat/exp rather than copying the old ones', () => {
    const claims = jwt.verify(reissueTokenWithSetupComplete(original), JWT_SECRET);
    expect(claims.iat).not.toBe(1000);
    expect(claims.exp).not.toBe(2000);
    expect(claims.exp).toBeGreaterThan(claims.iat);
  });
});
