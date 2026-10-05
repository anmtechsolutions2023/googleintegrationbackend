// src/__tests__/modules/tenant.switch.test.js
// Switching tenancy (POST /api/tenants/switch) yields the token a fresh
// sign-in there would.
//
// The live switch path read only the legacy per-membership grant table, so a
// switched-into token carried no role permissions; it never set
// onboardingStatus, so generateAppToken signed it as a 15-minute guest token;
// and when that legacy query was retired it crashed in production with "Can't
// add new command when connection is in closed state". It now shares the
// sign-in scope builder (auth/access.js).

const mockConn = { execute: jest.fn(), release: jest.fn() };

jest.mock('../../config/envConfig', () => ({ JWT_SECRET: 'test-secret' }));
jest.mock('../../config/db', () => ({
  getConnection: jest.fn(() => Promise.resolve(mockConn)),
}));
jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  captureAudit: jest.fn(),
}));
jest.mock('../../modules/mastersetup/mastersetup.repository', () => ({
  isSetupComplete: jest.fn(async () => true),
}));
jest.mock('../../modules/invitation/invitation.service', () => ({
  acceptPendingTx: jest.fn(async () => []),
}));

const jwt = require('jsonwebtoken');
const { QUERIES, SCOPES, AUDIT_ACTIONS } = require('../../config/constants');
const config = require('../../config/config');
const { switchTenantPermissions } = require('../../modules/tenant/tenant.service');
const { findAndGetPermissions, generateAppToken } = require('../../modules/auth/auth.service');

const PHONE = '+919800000002';
const req = { headers: {}, ip: '127.0.0.1' };

/** One fixture for both paths: the same membership, grants and roles. */
const wire = (membership) => {
  mockConn.execute.mockImplementation(async (sql) => {
    if (sql === QUERIES.USER_TENANTS.SELECT) return [[{ tenant_id: 'tenant-b', full_name: 'Asha', ...membership }]];
    if (sql === QUERIES.PERMISSIONS.SELECT_ALL_GRANTS) return [[{ feature_short_name: 'POS_ORDER', scope: 'READ' }]];
    if (sql === QUERIES.USER_ROLES.SELECT_BY_USER_TENANT) return [[{ role_name: 'POS_WAITER', role_is_active: 1 }]];
    return [[]];
  });
};

beforeEach(() => jest.clearAllMocks());

describe('switchTenantPermissions', () => {
  it('carries TENANT:SUPER_ADMIN for a super-admin membership, as sign-in does', async () => {
    wire({ is_admin: 1, is_super_admin: 1 });
    const switched = await switchTenantPermissions(req, PHONE, 'tenant-b', 'Asha');
    expect(switched.permissions).toEqual(['POS_ORDER:READ', SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN]);
  });

  it('reports the roles held in the target tenancy', async () => {
    wire({ is_admin: 0, is_super_admin: 0 });
    const switched = await switchTenantPermissions(req, PHONE, 'tenant-b', 'Asha');
    expect(switched.roles).toEqual(['POS_WAITER']);
  });

  it('matches a fresh sign-in into the same tenancy', async () => {
    wire({ is_admin: 1, is_super_admin: 0 });
    const switched = await switchTenantPermissions(req, PHONE, 'tenant-b', 'Asha');
    const signedIn = await findAndGetPermissions(req, { phone: PHONE, name: 'Asha' });
    expect(switched.permissions).toEqual(signedIn.permissions);
    expect(switched.roles).toEqual(signedIn.roles);
    expect(switched.name).toBe(signedIn.name);
  });

  it('reads grants with the tenancy-confined query', async () => {
    wire({ is_admin: 0, is_super_admin: 0 });
    await switchTenantPermissions(req, PHONE, 'tenant-b', 'Asha');
    const grants = mockConn.execute.mock.calls.find(([sql]) => sql === QUERIES.PERMISSIONS.SELECT_ALL_GRANTS);
    expect(grants[1]).toEqual(['tenant-b', PHONE]);
  });
});

describe('the token it produces', () => {
  it('is a full session, not a 15-minute guest token', async () => {
    wire({ is_admin: 0, is_super_admin: 0 });
    const switched = await switchTenantPermissions(req, PHONE, 'tenant-b', 'Asha');
    expect(switched.onboardingStatus).toBe('APPROVED');
    const claims = jwt.decode(generateAppToken(switched));
    expect(config.JWT.EXPIRATION).toBe('1h');
    expect(claims.exp - claims.iat).toBe(60 * 60);   // the guest expiry is 15 minutes
    expect(claims.setupCompleted).toBe(true);
    expect(claims.roles).toEqual(['POS_WAITER']);
  });

  it('refuses a tenancy the person does not belong to with 403, and audits it', async () => {
    wire({ is_admin: 0, is_super_admin: 0 });
    const { captureAudit } = require('../../utils/logger');
    await expect(switchTenantPermissions(req, PHONE, 'somebody-elses', 'Asha'))
      .rejects.toMatchObject({ statusCode: 403 });
    expect(captureAudit).toHaveBeenCalledWith(req, null, PHONE, AUDIT_ACTIONS.SWITCH_TENANT_DENIED, 'DENIED', 'TENANT_MGMT', 'WARN', 'somebody-elses');
  });

  it('names each tenancy in the token, for the tenant switcher', async () => {
    mockConn.execute.mockImplementation(async (sql) => {
      if (sql === QUERIES.USER_TENANTS.SELECT) {
        return [[
          { tenant_id: 'tenant-b', is_admin: 0, is_super_admin: 0, tenant_name: 'Mayini’s Kitchen' },
          { tenant_id: 'tenant-c', is_admin: 1, is_super_admin: 0, tenant_name: null },
        ]];
      }
      return [[]];
    });
    const switched = await switchTenantPermissions(req, PHONE, 'tenant-b', 'Asha');
    const claims = jwt.decode(generateAppToken(switched));
    expect(claims.associatedTenants).toEqual([
      { tenantId: 'tenant-b', name: 'Mayini’s Kitchen', isAdmin: false },
      { tenantId: 'tenant-c', name: null, isAdmin: true },
    ]);
  });

  it('remembers the tenancy for the next sign-in', async () => {
    wire({ is_admin: 0, is_super_admin: 0 });
    await switchTenantPermissions(req, PHONE, 'tenant-b', 'Asha');
    const touch = mockConn.execute.mock.calls.find(([sql]) => sql === QUERIES.USER_TENANTS.TOUCH_ACTIVE);
    expect(touch[1]).toEqual([PHONE, 'tenant-b']);
  });

  it('gives the connection back, even when it fails', async () => {
    mockConn.execute.mockRejectedValue(new Error('pool exhausted'));
    await expect(switchTenantPermissions(req, PHONE, 'tenant-b', 'Asha')).rejects.toThrow('pool exhausted');
    expect(mockConn.release).toHaveBeenCalled();
  });
});

describe('the grants query', () => {
  it('only counts roles of the same tenancy that are active, and no second grant path', () => {
    const sql = QUERIES.PERMISSIONS.SELECT_ALL_GRANTS;
    expect(sql).toMatch(/r\.tenant_id = ur\.tenant_id/);
    expect(sql).toMatch(/r\.is_active = TRUE/);
    expect(sql).not.toMatch(/tenant_features/);
    expect(sql).not.toMatch(/UNION/);
  });
});
