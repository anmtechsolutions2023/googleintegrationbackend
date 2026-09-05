// src/__tests__/modules/auth.autoapprove.test.js
// Guest-path auto-approval wiring in auth.service.findAndGetPermissions.
// DB + collaborating services fully mocked.

const mockConn = { execute: jest.fn(), release: jest.fn() };

jest.mock('../../config/db', () => ({
  getConnection: jest.fn(() => Promise.resolve(mockConn)),
}));
jest.mock('google-auth-library', () => ({
  OAuth2Client: jest.fn().mockImplementation(() => ({ verifyIdToken: jest.fn() })),
}));
jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  captureAudit: jest.fn(),
}));
jest.mock('../../modules/appconfig/appconfig.service', () => ({
  isAutoApproveEnabled: jest.fn(),
}));
jest.mock('../../modules/admin/admin.service', () => ({
  autoApproveOnboarding: jest.fn(),
}));
// Invitation claiming runs first on every login, but it is a collaborator here
// rather than the subject — mocked for the same reason as the setup lookup
// below, so it does not consume an entry from the sequenced queue. Its own
// behaviour is covered in invitation.service.test.js and auth.invite.test.js.
jest.mock('../../modules/invitation/invitation.service', () => ({
  acceptPendingTx: jest.fn(async () => []),
}));
// Setup-state lookup is a collaborator here, not the subject. Mocked so it does
// not consume entries from the sequenced mockConn.execute queue below.
jest.mock('../../modules/mastersetup/mastersetup.repository', () => ({
  isSetupComplete: jest.fn(async () => false),
}));

const { findAndGetPermissions } = require('../../modules/auth/auth.service');
const appConfig = require('../../modules/appconfig/appconfig.service');
const adminService = require('../../modules/admin/admin.service');
const setupRepository = require('../../modules/mastersetup/mastersetup.repository');
const { SCOPES } = require('../../config/constants');

const req = { headers: {}, ip: '127.0.0.1' };
const userData = { phone: '+919876500011', name: 'New User', googleId: 'g-123' };

beforeEach(() => jest.clearAllMocks());

describe('findAndGetPermissions — guest path auto-approval', () => {
  it('auto-approves a brand-new email into a new tenant when the flag is ON', async () => {
    appConfig.isAutoApproveEnabled.mockResolvedValue(true);
    adminService.autoApproveOnboarding.mockResolvedValue({
      tenantId: 'new-tenant', requestId: 'req-1', roleName: 'TENANT_ADMIN',
    });

    mockConn.execute
      .mockResolvedValueOnce([[]])  // USER_TENANTS.SELECT → not provisioned
      .mockResolvedValueOnce([[]])  // ONBOARDING_REQUESTS.SELECT_BY_PHONE → none
      // re-read provisioned user_tenants
      .mockResolvedValueOnce([[{ tenant_id: 'new-tenant', is_admin: 1, is_super_admin: 0 }]])
      // getScopesForTenant → ONE statement, the UNION of direct and role grants.
      // A fresh auto-approved tenant has no direct grants, so everything here
      // arrives via the TENANT_ADMIN role.
      .mockResolvedValueOnce([[{ feature_short_name: 'MASTER_DATA', scope: 'READ' }]])
      .mockResolvedValueOnce([[{ role_name: 'TENANT_ADMIN' }]]); // USER_ROLES

    const result = await findAndGetPermissions(req, userData);

    expect(adminService.autoApproveOnboarding).toHaveBeenCalledWith({
      phone: '+919876500011', name: 'New User', googleSub: 'g-123',
    });
    expect(result.onboardingStatus).toBe('APPROVED');
    expect(result.tenantId).toBe('new-tenant');
    expect(result.roles).toEqual(['TENANT_ADMIN']);
    expect(result.permissions).toContain(SCOPES.TENANT_ADMIN);
    expect(result.permissions).toContain('MASTER_DATA:READ');
  });

  it('reports the freshly created tenant as needing first-time setup', async () => {
    appConfig.isAutoApproveEnabled.mockResolvedValue(true);
    adminService.autoApproveOnboarding.mockResolvedValue({
      tenantId: 'new-tenant', requestId: 'req-1', roleName: 'TENANT_ADMIN',
    });
    // A brand-new tenant has no tenant_setup row.
    setupRepository.isSetupComplete.mockResolvedValue(false);

    mockConn.execute
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[{ tenant_id: 'new-tenant', is_admin: 1, is_super_admin: 0 }]])
      .mockResolvedValueOnce([[]])  // getScopesForTenant → no grants either way
      .mockResolvedValueOnce([[{ role_name: 'TENANT_ADMIN' }]]);

    const result = await findAndGetPermissions(req, userData);

    // Drives setupCompleted:false into the JWT, so the new tenant admin is sent
    // straight to the setup wizard rather than into an unconfigured app.
    // The connection is passed rather than left out: this lookup must borrow the
    // sign-in's own connection instead of taking a second one from the pool, or
    // concurrent logins deadlock it.
    expect(setupRepository.isSetupComplete).toHaveBeenCalledWith(
      'new-tenant',
      mockConn
    );
    expect(result.setupCompleted).toBe(false);
  });

  it('leaves a brand-new email PENDING when the flag is OFF', async () => {
    appConfig.isAutoApproveEnabled.mockResolvedValue(false);

    mockConn.execute
      .mockResolvedValueOnce([[]])                 // USER_TENANTS.SELECT → not provisioned
      .mockResolvedValueOnce([[]])                 // ONBOARDING_REQUESTS.SELECT_BY_PHONE → none
      .mockResolvedValueOnce([{ affectedRows: 1 }]); // ONBOARDING_REQUESTS.INSERT

    const result = await findAndGetPermissions(req, userData);

    expect(adminService.autoApproveOnboarding).not.toHaveBeenCalled();
    expect(result.onboardingStatus).toBe('PENDING');
    expect(result.tenantId).toBeNull();
    expect(result.permissions).toEqual([SCOPES.GUEST_EXPLORE]);
  });

  it('falls back to PENDING when auto-approval throws', async () => {
    appConfig.isAutoApproveEnabled.mockResolvedValue(true);
    adminService.autoApproveOnboarding.mockRejectedValue(new Error('boom'));

    mockConn.execute
      .mockResolvedValueOnce([[]])                 // USER_TENANTS.SELECT
      .mockResolvedValueOnce([[]])                 // ONBOARDING_REQUESTS.SELECT_BY_PHONE
      .mockResolvedValueOnce([{ affectedRows: 1 }]); // ONBOARDING_REQUESTS.INSERT (fallback)

    const result = await findAndGetPermissions(req, userData);

    expect(result.onboardingStatus).toBe('PENDING');
    expect(result.permissions).toEqual([SCOPES.GUEST_EXPLORE]);
  });
});
