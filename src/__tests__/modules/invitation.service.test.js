// Tenant invitations: a tenancy asking a person to join it.
//
// The counterpart to onboarding_requests. A request is raised BY a person and
// has no tenant until an admin picks one; an invitation is raised BY a tenancy
// and carries its tenant and roles from creation — which is what lets an
// invited user land in the RIGHT tenancy instead of being auto-provisioned one.

jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  captureAudit: jest.fn(),
}));
jest.mock('uuid', () => ({ v4: jest.fn(() => 'mock-uuid') }));

let state;
const executed = [];
const dup = () => Object.assign(new Error('dup'), { code: 'ER_DUP_ENTRY' });

const mockConn = {
  execute: jest.fn(async (sql, params) => {
    executed.push({ sql: String(sql), params });
    const q = String(sql);
    if (/FROM user_tenants WHERE user_email/.test(q)) return [state.membership];
    if (/SELECT id FROM roles WHERE tenant_id/.test(q)) return [state.tenantRoles];
    // roleGuard resolves the NAMES behind the ids, to refuse SUPER_ADMIN.
    if (/SELECT name FROM roles WHERE tenant_id/.test(q)) return [state.roleNames];
    if (/FROM tenant_invitations\s*\n?\s*WHERE email/.test(q) || /SELECT id, tenant_id, email, is_admin/.test(q)) {
      return [state.claimable];
    }
    if (/FROM tenant_invitation_roles/.test(q)) return [state.inviteRoles];
    if (/INSERT INTO tenant_invitations/.test(q)) {
      if (state.insertDuplicates) throw dup();
      return [{ affectedRows: 1 }];
    }
    if (/INSERT INTO user_tenants/.test(q)) {
      if (state.membershipExists) throw dup();
      return [{ affectedRows: 1 }];
    }
    if (/UPDATE tenant_invitations SET status = 'REVOKED'/.test(q)) {
      return [{ affectedRows: state.revokeHits ? 1 : 0 }];
    }
    if (/FROM tenant_invitations i/.test(q)) return [state.list];
    return [{ affectedRows: 1 }];
  }),
};
jest.mock('../../utils/dbHelper', () => ({
  withConnection: async (cb) => cb(mockConn),
  withTransaction: async (cb) => cb(mockConn),
}));

const service = require('../../modules/invitation/invitation.service');

const TENANT = 'tenant-a';
const ADMIN = 'admin@x.com';

beforeEach(() => {
  executed.length = 0;
  mockConn.execute.mockClear();
  state = {
    membership: [], tenantRoles: [{ id: 'role-1' }, { id: 'role-2' }],
    claimable: [], inviteRoles: [], list: [],
    roleNames: [{ name: 'POS_MANAGER' }],
    insertDuplicates: false, membershipExists: false, revokeHits: true,
  };
});

const sqlOf = (re) => executed.filter((e) => re.test(e.sql));

describe('raising an invitation', () => {
  it('records the tenancy, the invitee and who invited them', async () => {
    const res = await service.createInvitation({
      tenantId: TENANT, email: 'New@Person.com', roleIds: ['role-1'], invitedBy: ADMIN,
    });
    const insert = sqlOf(/INSERT INTO tenant_invitations/)[0];
    // id, tenant, email, isAdmin, fullName, phone, branch, invitedBy, expiresAt
    expect(insert.params.slice(0, 8))
      .toEqual(['mock-uuid', TENANT, 'new@person.com', 0, null, null, null, ADMIN]);
    expect(res.email).toBe('new@person.com');
  });

  // A staff member IS a membership, so the details that used to live on a
  // separate roster travel with the invitation and land on the membership when
  // it is claimed. Otherwise a new joiner shows up as a bare email that
  // somebody then has to identify.
  it('carries the staff details so the person arrives named', async () => {
    await service.createInvitation({
      tenantId: TENANT, email: 'chef@x.com', invitedBy: ADMIN,
      profile: { fullName: 'Priya R', phone: '9876543210', branchDetailId: 'branch-1' },
    });
    expect(sqlOf(/INSERT INTO tenant_invitations/)[0].params.slice(4, 7))
      .toEqual(['Priya R', '9876543210', 'branch-1']);
  });

  // The same account can sign in with either casing; storing the raw form would
  // make the claim at login miss.
  it('normalizes the email to lower case', async () => {
    await service.createInvitation({ tenantId: TENANT, email: '  MiXeD@Case.COM ', invitedBy: ADMIN });
    expect(sqlOf(/INSERT INTO tenant_invitations/)[0].params[2]).toBe('mixed@case.com');
  });

  it('carries an expiry so a forgotten invitation does not stay live forever', async () => {
    await service.createInvitation({ tenantId: TENANT, email: 'a@b.com', invitedBy: ADMIN });
    const expiresAt = sqlOf(/INSERT INTO tenant_invitations/)[0].params[8];
    expect(expiresAt).toBeInstanceOf(Date);
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  // TENANT:ADMIN comes from user_tenants.is_admin, never from a role, so
  // without this you could not invite a co-admin at all.
  it('can invite a co-admin', async () => {
    await service.createInvitation({ tenantId: TENANT, email: 'a@b.com', isAdmin: true, invitedBy: ADMIN });
    expect(sqlOf(/INSERT INTO tenant_invitations/)[0].params[3]).toBe(1);
  });

  it('attaches the roles the invitee will receive', async () => {
    await service.createInvitation({
      tenantId: TENANT, email: 'a@b.com', roleIds: ['role-1', 'role-2'], invitedBy: ADMIN,
    });
    expect(sqlOf(/INSERT INTO tenant_invitation_roles/)).toHaveLength(2);
  });

  // An invitation is a MEMBERSHIP request. Someone already in the tenancy has a
  // membership, so this would be a role edit wearing the wrong hat.
  it('refuses to invite an existing member', async () => {
    state.membership = [{ id: 'ut-1' }];
    await expect(service.createInvitation({
      tenantId: TENANT, email: 'a@b.com', invitedBy: ADMIN,
    })).rejects.toThrow(/already in this tenancy/i);
  });

  it('refuses a second live invitation for the same email', async () => {
    state.insertDuplicates = true;
    await expect(service.createInvitation({
      tenantId: TENANT, email: 'a@b.com', invitedBy: ADMIN,
    })).rejects.toThrow(/already a pending invitation/i);
  });

  // Without this an admin could name a role id belonging to ANOTHER tenancy and
  // grant its permissions inside their own.
  it('refuses roles that do not belong to the inviting tenancy', async () => {
    await expect(service.createInvitation({
      tenantId: TENANT, email: 'a@b.com', roleIds: ['role-from-elsewhere'], invitedBy: ADMIN,
    })).rejects.toThrow(/do not belong to this tenancy/i);
  });
});

describe('revoking', () => {
  it('marks the row REVOKED rather than deleting it', async () => {
    await service.revokeInvitation('inv-1', TENANT);
    const q = sqlOf(/UPDATE tenant_invitations/)[0];
    expect(q.sql).toMatch(/status = 'REVOKED'/);
    expect(q.sql).not.toMatch(/DELETE/);
  });

  it('is scoped to the caller\'s tenancy', async () => {
    await service.revokeInvitation('inv-1', TENANT);
    expect(sqlOf(/UPDATE tenant_invitations/)[0].params).toEqual(['inv-1', TENANT]);
  });

  it('404s when there is nothing pending to revoke', async () => {
    state.revokeHits = false;
    await expect(service.revokeInvitation('inv-1', TENANT)).rejects.toThrow(/No pending invitation/i);
  });
});

describe('claiming at login', () => {
  const invite = (over = {}) => ({
    id: 'inv-1', tenant_id: TENANT, email: 'a@b.com', is_admin: 0, ...over,
  });

  it('does nothing, and touches no table, when there is no invitation', async () => {
    const claimed = await service.acceptPendingTx(mockConn, 'a@b.com');
    expect(claimed).toEqual([]);
    expect(sqlOf(/INSERT INTO user_tenants/)).toHaveLength(0);
  });

  it('creates the membership and grants the invited roles', async () => {
    state.claimable = [invite()];
    state.inviteRoles = [{ role_id: 'role-1' }, { role_id: 'role-2' }];

    const claimed = await service.acceptPendingTx(mockConn, 'a@b.com');

    expect(sqlOf(/INSERT INTO user_tenants/)[0].params.slice(1, 4)).toEqual(['a@b.com', TENANT, 0]);
    expect(sqlOf(/INSERT INTO user_roles/)).toHaveLength(2);
    expect(claimed).toEqual([{ tenantId: TENANT, roleCount: 2 }]);
  });

  // The invitation is how a staff member is added, so the details it carried
  // must land on the membership — that row IS the staff record.
  it('stamps the staff details onto the new membership', async () => {
    state.claimable = [invite({ full_name: 'Priya R', phone: '9876543210', branch_detail_id: 'branch-1' })];

    await service.acceptPendingTx(mockConn, 'a@b.com');

    const profile = sqlOf(/UPDATE user_tenants SET full_name/)[0];
    expect(profile.params).toEqual(['Priya R', '9876543210', 'branch-1', 'a@b.com', TENANT]);
  });

  it('writes no profile update when the invitation carried no details', async () => {
    state.claimable = [invite()];
    await service.acceptPendingTx(mockConn, 'a@b.com');
    expect(sqlOf(/UPDATE user_tenants SET full_name/)).toHaveLength(0);
  });

  it('honours the co-admin flag', async () => {
    state.claimable = [invite({ is_admin: 1 })];
    await service.acceptPendingTx(mockConn, 'a@b.com');
    expect(sqlOf(/INSERT INTO user_tenants/)[0].params[3]).toBe(1);
  });

  it('closes the invitation so it cannot be claimed twice', async () => {
    state.claimable = [invite()];
    await service.acceptPendingTx(mockConn, 'a@b.com');
    expect(sqlOf(/SET status = 'ACCEPTED'/)).toHaveLength(1);
  });

  // Your multi-tenancy case: two tenancies invite the same person.
  it('claims every live invitation, so one person joins several tenancies', async () => {
    state.claimable = [invite(), invite({ id: 'inv-2', tenant_id: 'tenant-b' })];
    const claimed = await service.acceptPendingTx(mockConn, 'a@b.com');
    expect(claimed.map((c) => c.tenantId)).toEqual([TENANT, 'tenant-b']);
    expect(sqlOf(/INSERT INTO user_tenants/)).toHaveLength(2);
  });

  // Two tabs finishing OAuth at once must not double-provision.
  it('treats an existing membership as success rather than failing the login', async () => {
    state.claimable = [invite()];
    state.membershipExists = true;
    await expect(service.acceptPendingTx(mockConn, 'a@b.com')).resolves.toHaveLength(1);
    expect(sqlOf(/SET status = 'ACCEPTED'/)).toHaveLength(1);
  });

  // Roles can be deleted between invite and first login. Locking somebody out
  // is worse than admitting them with fewer rights than intended.
  it('still creates the membership when every invited role has been deleted', async () => {
    state.claimable = [invite()];
    state.inviteRoles = [];
    const claimed = await service.acceptPendingTx(mockConn, 'a@b.com');
    expect(sqlOf(/INSERT INTO user_tenants/)).toHaveLength(1);
    expect(claimed[0].roleCount).toBe(0);
  });

  // Expiry is applied in SQL so a lapsed invitation is simply never selected —
  // no sweep job is needed to keep the claim path correct.
  it('reads only live invitations, filtering expiry in the query', async () => {
    await service.acceptPendingTx(mockConn, 'a@b.com');
    const q = executed.find((e) => /status = 'PENDING'/.test(e.sql));
    expect(q.sql).toMatch(/expires_at IS NULL OR expires_at > NOW\(\)/);
  });

  it('matches the invitation case-insensitively', async () => {
    await service.acceptPendingTx(mockConn, 'A@B.com');
    expect(executed[0].params[0]).toBe('a@b.com');
  });
});
