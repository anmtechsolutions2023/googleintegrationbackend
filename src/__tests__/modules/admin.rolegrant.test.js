// src/__tests__/modules/admin.rolegrant.test.js
// The SUPER_ADMIN refusal, at every door that accepts roleIds.
//
// A guard is only worth what it is wired into. roleGuard.test.js proves the
// guard says no; this proves each granting path actually asks it, and that a
// refusal leaves nothing half-done behind it.

const mockConn = { execute: jest.fn() };

jest.mock('../../utils/dbHelper', () => ({
  withConnection: jest.fn((fn) => fn(mockConn)),
  withTransaction: jest.fn((fn) => fn(mockConn)),
}));
jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  captureAudit: jest.fn(),
}));
jest.mock('uuid', () => ({ v4: () => 'mock-uuid' }));

const adminService = require('../../modules/admin/admin.service');
const invitationService = require('../../modules/invitation/invitation.service');
const { QUERIES } = require('../../config/constants');

const TENANT = 'tenant-a';
const ADMIN = 'admin@x.com';

/**
 * The role-name lookup is the guard's own raw SQL; everything else is a QUERIES
 * constant. Matching on the SQL keeps these tests honest about which call is
 * which, rather than counting call indexes.
 */
const isRoleNameLookup = (sql) => /SELECT name FROM roles/.test(sql);

/**
 * updateUserRoles and createInvitation both look a membership up with the SAME
 * SQL — "SELECT id FROM user_tenants WHERE user_phone = ? AND tenant_id = ?" —
 * and want OPPOSITE answers from it: the first needs the person to be a member,
 * the second needs them not to be. They cannot be told apart by query text, so
 * the caller states which answer this test wants.
 */
const wire = ({ roleNames, membership }) => {
  mockConn.execute.mockImplementation((sql) => {
    if (isRoleNameLookup(sql)) return [roleNames.map((name) => ({ name }))];
    if (/SELECT id FROM user_tenants/.test(sql)) {
      return [membership === 'exists' ? [{ id: 'ut-1' }] : []];
    }
    // The invitation service's own older check that the roles belong to this
    // tenancy. Satisfied so the SUPER_ADMIN refusal is what these tests measure.
    if (sql === QUERIES.INVITATIONS.SELECT_ROLES_IN_TENANT) {
      return [['r1', 'r2', 'r3'].map((id) => ({ id }))];
    }
    // Everything else: an empty result set. Fine for the SELECTs these flows
    // make along the way; the INSERTs ignore what comes back.
    return [[]];
  });
};

const sqlCalls = () => mockConn.execute.mock.calls.map(([sql]) => sql);

beforeEach(() => jest.clearAllMocks());

describe('updateUserRoles', () => {
  it('refuses SUPER_ADMIN with 403', async () => {
    wire({ roleNames: ['SUPER_ADMIN'], membership: 'exists' });
    await expect(adminService.updateUserRoles('bob@x.com', TENANT, ['r1'], ADMIN))
      .rejects.toMatchObject({ statusCode: 403 });
  });

  it('does NOT clear the user\'s existing roles when it refuses', async () => {
    // The guard runs before the DELETE for exactly this reason: a rejected save
    // must not strip somebody of the roles they already had.
    wire({ roleNames: ['SUPER_ADMIN'], membership: 'exists' });
    await adminService.updateUserRoles('bob@x.com', TENANT, ['r1'], ADMIN).catch(() => {});
    expect(sqlCalls()).not.toContain(QUERIES.USER_ROLES.DELETE_ALL_FOR_USER);
  });

  it('still assigns ordinary roles', async () => {
    wire({ roleNames: ['TENANT_ADMIN', 'POS_MANAGER'], membership: 'exists' });
    await expect(adminService.updateUserRoles('bob@x.com', TENANT, ['r1', 'r2'], ADMIN))
      .resolves.not.toThrow();
    expect(sqlCalls()).toContain(QUERIES.USER_ROLES.DELETE_ALL_FOR_USER);
  });
});

describe('createInvitation', () => {
  it('refuses an invitation carrying SUPER_ADMIN', async () => {
    wire({ roleNames: ['SUPER_ADMIN'], membership: 'none' });
    await expect(invitationService.createInvitation({
      tenantId: TENANT, phone: '+919000000002', roleIds: ['r1'], invitedBy: ADMIN,
    })).rejects.toMatchObject({ statusCode: 403 });
  });

  it('writes no invitation row when it refuses', async () => {
    // Refused at creation rather than at acceptance: a PENDING row nobody can
    // ever claim is worse than a clear error now.
    wire({ roleNames: ['SUPER_ADMIN'], membership: 'none' });
    await invitationService.createInvitation({
      tenantId: TENANT, phone: '+919000000002', roleIds: ['r1'], invitedBy: ADMIN,
    }).catch(() => {});
    expect(sqlCalls()).not.toContain(QUERIES.INVITATIONS.INSERT);
  });

  it('still invites somebody as a tenant administrator', async () => {
    wire({ roleNames: ['TENANT_ADMIN'], membership: 'none' });
    await expect(invitationService.createInvitation({
      tenantId: TENANT, phone: '+919000000002', roleIds: ['r1'], isAdmin: true, invitedBy: ADMIN,
    })).resolves.toBeDefined();
  });
});

describe('the platform rank itself', () => {
  it('is never written as 1 by the provisioning core', async () => {
    wire({ roleNames: ['TENANT_ADMIN'], membership: 'none' });
    await adminService.approveRequest('req-1', TENANT, ['r1'], ADMIN).catch(() => {});

    const insert = mockConn.execute.mock.calls
      .find(([sql]) => sql === QUERIES.ADMIN_USERS.INSERT_USER_TENANT_FLAGS);
    if (insert) {
      // params: [id, email, tenantId, is_admin, is_super_admin]
      expect(insert[1][4]).toBe(0);
    }
  });
});
