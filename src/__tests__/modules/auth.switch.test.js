// src/__tests__/modules/auth.switch.test.js
// Switching tenancy yields the token a fresh sign-in there would.
//
// switchTenantPermissions used to build its own scope list: it added
// TENANT:ADMIN for an admin membership but never TENANT:SUPER_ADMIN, and
// reported no roles at all. Both paths now share one builder (auth/access.js).

const mockConn = { execute: jest.fn(), release: jest.fn() };

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

const { QUERIES, SCOPES } = require('../../config/constants');
const { switchTenantPermissions, findAndGetPermissions } = require('../../modules/auth/auth.service');

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

describe('the grants query', () => {
  it('only counts roles of the same tenancy that are active, and no second grant path', () => {
    const sql = QUERIES.PERMISSIONS.SELECT_ALL_GRANTS;
    expect(sql).toMatch(/r\.tenant_id = ur\.tenant_id/);
    expect(sql).toMatch(/r\.is_active = TRUE/);
    expect(sql).not.toMatch(/tenant_features/);
    expect(sql).not.toMatch(/UNION/);
  });
});
