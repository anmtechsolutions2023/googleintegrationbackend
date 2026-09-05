// Login precedence: an invitation beats auto-provisioning.
//
// The whole point of claiming invitations at the TOP of findAndGetPermissions,
// unconditionally, rather than inside the "unknown email" branch:
//
//   * a brand-new invited email joins the INVITING tenancy and is NOT handed a
//     fresh tenancy of its own, even with auto-approve on;
//   * an EXISTING member who is invited elsewhere gains a second membership —
//     they already pass the provisioned path, so a claim placed lower down
//     would never run for them.

const mockConn = { execute: jest.fn(), release: jest.fn() };

jest.mock('../../config/db', () => ({ getConnection: jest.fn(async () => mockConn) }));
jest.mock('google-auth-library', () => ({
  OAuth2Client: jest.fn().mockImplementation(() => ({ verifyIdToken: jest.fn() })),
}));
jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  captureAudit: jest.fn(),
}));
jest.mock('../../modules/appconfig/appconfig.service', () => ({
  isAutoApproveEnabled: jest.fn(async () => true),
}));
jest.mock('../../modules/admin/admin.service', () => ({
  autoApproveOnboarding: jest.fn(),
}));
jest.mock('../../modules/mastersetup/mastersetup.repository', () => ({
  isSetupComplete: jest.fn(async () => true),
}));
jest.mock('../../modules/invitation/invitation.service', () => ({
  acceptPendingTx: jest.fn(async () => []),
}));

const { findAndGetPermissions } = require('../../modules/auth/auth.service');
const adminService = require('../../modules/admin/admin.service');
const invitations = require('../../modules/invitation/invitation.service');

const req = { headers: {}, ip: '127.0.0.1' };
const userData = { phone: '+919876501011', name: 'Invited', googleId: 'g-1' };

/** Answers by query shape rather than call order, so extra reads don't shift it. */
const route = (memberships) => {
  mockConn.execute.mockImplementation(async (sql) => {
    const q = String(sql);
    if (/FROM user_tenants/.test(q) && /SELECT tenant_id/.test(q)) return [memberships];
    if (/UPDATE user_tenants/.test(q)) return [{ affectedRows: 1 }];
    if (/FROM onboarding_requests/.test(q)) return [[]];
    if (/tenant_features/.test(q)) return [[]];
    if (/user_roles ur/.test(q)) return [[{ feature_short_name: 'POS_ORDER', scope: 'READ' }]];
    if (/FROM user_roles/.test(q)) return [[{ role_name: 'POS_CASHIER' }]];
    return [[]];
  });
};

beforeEach(() => jest.clearAllMocks());

describe('an invitation outranks auto-provisioning', () => {
  it('claims invitations before memberships are even read', async () => {
    route([]);
    await findAndGetPermissions(req, userData);
    expect(invitations.acceptPendingTx).toHaveBeenCalledWith(mockConn, '+919876501011');
  });

  // The primary ask: with auto-approve ON, an invited newcomer must NOT be
  // handed a tenancy of their own.
  it('gives an invited newcomer the inviting tenancy, not a new one', async () => {
    let claimed = false;
    invitations.acceptPendingTx.mockImplementation(async () => {
      claimed = true;
      return [{ tenantId: 'inviting-tenant', roleCount: 2 }];
    });
    // The membership the claim just created is what the next read returns.
    mockConn.execute.mockImplementation(async (sql) => {
      const q = String(sql);
      if (/FROM user_tenants/.test(q) && /SELECT tenant_id/.test(q)) {
        return [claimed ? [{ tenant_id: 'inviting-tenant', is_admin: 0, is_super_admin: 0 }] : []];
      }
      if (/UPDATE user_tenants/.test(q)) return [{ affectedRows: 1 }];
      if (/user_roles ur/.test(q)) return [[{ feature_short_name: 'POS_ORDER', scope: 'READ' }]];
      if (/FROM user_roles/.test(q)) return [[{ role_name: 'POS_CASHIER' }]];
      return [[]];
    });

    const result = await findAndGetPermissions(req, userData);

    expect(result.tenantId).toBe('inviting-tenant');
    expect(result.onboardingStatus).toBe('APPROVED');
    // The decisive assertion: no tenancy was minted for them.
    expect(adminService.autoApproveOnboarding).not.toHaveBeenCalled();
  });

  it('still auto-provisions a newcomer who was NOT invited', async () => {
    route([]);
    await findAndGetPermissions(req, userData);
    expect(adminService.autoApproveOnboarding).toHaveBeenCalled();
  });

  // A broken invitation must not cost somebody their sign-in.
  it('signs the user in even if claiming throws', async () => {
    invitations.acceptPendingTx.mockRejectedValue(new Error('db down'));
    route([{ tenant_id: 'existing', is_admin: 0, is_super_admin: 0 }]);
    const result = await findAndGetPermissions(req, userData);
    expect(result.tenantId).toBe('existing');
  });
});

describe('multi-tenancy', () => {
  // An existing member passes the provisioned path, so a claim placed after the
  // membership lookup would never run for them.
  it('claims for an EXISTING member too, so they can gain a second tenancy', async () => {
    route([{ tenant_id: 'existing', is_admin: 1, is_super_admin: 0 }]);
    await findAndGetPermissions(req, userData);
    expect(invitations.acceptPendingTx).toHaveBeenCalled();
  });

  // Previously tenantRows[0] of an unordered query — arbitrary, and liable to
  // differ between logins.
  it('resumes the most recently active tenancy', async () => {
    route([
      { tenant_id: 'most-recent', is_admin: 0, is_super_admin: 0 },
      { tenant_id: 'older', is_admin: 0, is_super_admin: 0 },
    ]);
    const result = await findAndGetPermissions(req, userData);
    expect(result.tenantId).toBe('most-recent');
    expect(result.associatedTenants).toHaveLength(2);
  });

  it('stamps the active tenancy so the next login returns to it', async () => {
    route([{ tenant_id: 'here', is_admin: 0, is_super_admin: 0 }]);
    await findAndGetPermissions(req, userData);
    const touch = mockConn.execute.mock.calls.find(([sql]) => /UPDATE user_tenants/.test(String(sql)));
    expect(touch[1]).toEqual(['+919876501011', 'here']);
  });
});
