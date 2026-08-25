// Granting tenant-administrator access.
//
// The bug this closes: TENANT:ADMIN is derived from user_tenants.is_admin at
// login and NEVER from a role. A user assigned the role named 'SUPER_ADMIN'
// received all 29 of that role's feature scopes and was still refused the
// Access Control screen, because none of those scopes is TENANT:ADMIN.

jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  captureAudit: jest.fn(),
}));

let state;
const executed = [];
const mockConn = {
  execute: jest.fn(async (sql, params) => {
    executed.push({ sql: String(sql), params });
    if (/SELECT is_super_admin/.test(String(sql))) return [state.member];
    if (/SELECT id FROM user_tenants/.test(String(sql))) return [state.member];
    return [{ affectedRows: 1 }];
  }),
};
jest.mock('../../utils/dbHelper', () => ({
  withConnection: async (cb) => cb(mockConn),
  withTransaction: async (cb) => cb(mockConn),
}));

const service = require('../../modules/admin/admin.service');

const TENANT = 'tenant-a';
const ACTOR = 'admin@x.com';

beforeEach(() => {
  executed.length = 0;
  mockConn.execute.mockClear();
  state = { member: [{ is_super_admin: 0 }] };
});

const flagUpdate = () => executed.find((e) => /SET is_admin/.test(e.sql));

describe('granting tenant-admin access', () => {
  it('sets the flag the login path actually reads', async () => {
    await service.setTenantAdmin('staff@x.com', TENANT, true, ACTOR);
    expect(flagUpdate().params).toEqual([1, 'staff@x.com', TENANT]);
  });

  it('withdraws it again', async () => {
    await service.setTenantAdmin('staff@x.com', TENANT, false, ACTOR);
    expect(flagUpdate().params[0]).toBe(0);
  });

  it('is confined to the caller\'s tenancy', async () => {
    await service.setTenantAdmin('staff@x.com', TENANT, true, ACTOR);
    expect(flagUpdate().sql).toMatch(/WHERE user_email = \? AND tenant_id = \?/);
  });

  it('404s for somebody who is not in this tenancy', async () => {
    state.member = [];
    await expect(service.setTenantAdmin('nobody@x.com', TENANT, true, ACTOR))
      .rejects.toThrow(/not found in tenant/i);
  });
});

describe('guards', () => {
  // Same reasoning as self-suspend: there would be no way back in.
  it('refuses to let an admin withdraw their own access', async () => {
    await expect(service.setTenantAdmin(ACTOR, TENANT, false, ACTOR))
      .rejects.toThrow(/cannot remove your own administrator access/i);
    expect(flagUpdate()).toBeUndefined();
  });

  // Granting to yourself is a harmless no-op — you already have it.
  it('allows a self-GRANT, which changes nothing', async () => {
    await expect(service.setTenantAdmin(ACTOR, TENANT, true, ACTOR)).resolves.toBeUndefined();
  });

  it('compares emails case-insensitively', async () => {
    await expect(service.setTenantAdmin('ADMIN@X.com', TENANT, false, ACTOR))
      .rejects.toThrow(/your own administrator access/i);
  });

  // A super admin already passes every check through the checkScope bypass, so
  // toggling their tenant-admin flag is meaningless at best.
  it('refuses to touch a super admin', async () => {
    state.member = [{ is_super_admin: 1 }];
    await expect(service.setTenantAdmin('super@x.com', TENANT, false, ACTOR))
      .rejects.toThrow(/super admin/i);
    expect(flagUpdate()).toBeUndefined();
  });
});

describe('what removing a user from a tenancy does', () => {
  // Membership-scoped by design. There is no users table — identity is Google —
  // so "deleting a user" can only mean ending their membership HERE. Anyone
  // with memberships elsewhere keeps them; anyone left with none becomes an
  // unprovisioned email again and starts fresh on their next sign-in.
  it('deletes the membership and its roles for THIS tenancy only', async () => {
    await service.removeUser('staff@x.com', TENANT, ACTOR);
    const roles = executed.find((e) => /DELETE FROM user_roles/.test(e.sql));
    const member = executed.find((e) => /DELETE FROM user_tenants/.test(e.sql));
    expect(roles.params).toEqual(['staff@x.com', TENANT]);
    expect(member.params).toEqual(['staff@x.com', TENANT]);
    // Never an unscoped delete of the person.
    expect(member.sql).toMatch(/WHERE user_email = \? AND tenant_id = \?/);
  });

  it('refuses to let an admin remove themselves', async () => {
    await expect(service.removeUser(ACTOR, TENANT, ACTOR)).rejects.toThrow(/your own account/i);
  });
});

// Requirement: a tenant admin must not be able to modify their OWN roles, while
// keeping full access across their tenancy. Both halves matter — the guard is
// deliberately narrow.
describe('an admin editing their own roles', () => {
  const roleWrites = () => executed.filter((e) => /user_roles/.test(e.sql));

  it('is refused, and writes nothing', async () => {
    await expect(service.updateUserRoles(ACTOR, TENANT, ['role-1'], ACTOR))
      .rejects.toThrow(/cannot change your own roles/i);
    expect(roleWrites()).toHaveLength(0);
  });

  it('is refused whatever the casing of the email', async () => {
    await expect(service.updateUserRoles('Admin@X.com', TENANT, [], ACTOR))
      .rejects.toThrow(/your own roles/i);
  });

  // The guard covers roles only. Tenant-admin access comes from the membership
  // flag, not from a role, so the admin keeps everything else in their tenancy.
  it('still lets them edit anybody else', async () => {
    await service.updateUserRoles('staff@x.com', TENANT, ['role-1'], ACTOR);
    expect(executed.find((e) => /DELETE FROM user_roles/.test(e.sql)).params)
      .toEqual(['staff@x.com', TENANT]);
    expect(executed.filter((e) => /INSERT INTO user_roles/.test(e.sql))).toHaveLength(1);
  });
});

// Staff and users are ONE entity: the membership row IS the staff record.
describe('the staff details on a membership', () => {
  const profileWrite = () => executed.find((e) => /UPDATE user_tenants SET full_name/.test(e.sql));

  it('are written to the membership, scoped to this tenancy', async () => {
    await service.updateUserProfile('staff@x.com', TENANT,
      { fullName: 'Priya R', phone: '9876543210', branchDetailId: 'branch-1' }, ACTOR);
    expect(profileWrite().params)
      .toEqual(['Priya R', '9876543210', 'branch-1', 'staff@x.com', TENANT]);
    expect(profileWrite().sql).toMatch(/WHERE user_email = \? AND tenant_id = \?/);
  });

  // Clearing a phone number or unassigning a branch is a legitimate edit.
  it('can be cleared', async () => {
    await service.updateUserProfile('staff@x.com', TENANT, {}, ACTOR);
    expect(profileWrite().params.slice(0, 3)).toEqual([null, null, null]);
  });

  it('404s for somebody who is not in this tenancy', async () => {
    state.member = [];
    await expect(service.updateUserProfile('nobody@x.com', TENANT, { fullName: 'X' }, ACTOR))
      .rejects.toThrow(/not found in tenant/i);
    expect(profileWrite()).toBeUndefined();
  });

  // Unlike roles and the admin flag, editing your own name is harmless: it
  // cannot lock you out of anything.
  it('an admin may correct their own', async () => {
    await expect(service.updateUserProfile(ACTOR, TENANT, { phone: '999' }, ACTOR))
      .resolves.toBeUndefined();
  });
});
