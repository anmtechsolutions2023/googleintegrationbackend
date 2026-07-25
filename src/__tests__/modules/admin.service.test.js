// src/__tests__/modules/admin.service.test.js

const mockConn = {
  execute: jest.fn(),
  query: jest.fn(),
};

jest.mock('uuid', () => ({ v4: () => 'mock-uuid' }));
jest.mock('../../utils/dbHelper', () => ({
  withConnection: jest.fn((fn) => fn(mockConn)),
  withTransaction: jest.fn((fn) => fn(mockConn)),
}));
jest.mock('../../utils/paginationHelper', () => ({
  calculatePagination: jest.fn(() => ({ pageNum: 1, limitNum: 20, offset: 0 })),
  getPaginationMetadata: jest.fn(() => ({ page: 1, limit: 20, total: 1, totalPages: 1 })),
}));
jest.mock('../../config/constants', () => ({
  QUERIES: {
    ONBOARDING_REQUESTS: {
      SELECT_ALL: 'SELECT * FROM onboarding_requests WHERE 1=1',
      INSERT: 'INSERT INTO onboarding_requests ...',
      UPDATE_STATUS: 'UPDATE onboarding_requests SET status=? ...',
    },
    ADMIN_USERS: {
      SELECT_ALL: 'SELECT * FROM user_tenants WHERE tenant_id = ?',
      SELECT_ALL_TENANTS: 'SELECT * FROM user_tenants',
      COUNT_ALL_TENANTS: 'SELECT COUNT(*) as total FROM user_tenants',
      SELECT_FLAGS_BY_EMAIL_TENANT: 'SELECT is_super_admin FROM user_tenants WHERE user_email = ? AND tenant_id = ?',
      SELECT_BY_EMAIL: 'SELECT * FROM user_tenants WHERE user_email = ?',
      INSERT_USER_TENANT: 'INSERT INTO user_tenants ...',
      INSERT_USER_TENANT_FLAGS: 'INSERT INTO user_tenants (... is_admin, is_super_admin ...) VALUES (?, ?, ?, ?, ?, ...)',
      UPDATE_STATUS: 'UPDATE user_tenants SET is_active=? ...',
      DELETE: 'DELETE FROM user_tenants WHERE ...',
    },
    USER_ROLES: {
      SELECT_BY_USER_TENANT: 'SELECT * FROM user_roles WHERE ...',
      DELETE_ALL_FOR_USER: 'DELETE FROM user_roles WHERE ...',
      INSERT: 'INSERT INTO user_roles ...',
    },
    ROLES: {
      SELECT_WITH_COUNTS: 'SELECT * FROM roles WHERE tenant_id = ?',
      SELECT_BY_ID: 'SELECT * FROM roles WHERE id = ?',
      INSERT: 'INSERT INTO roles ...',
      UPDATE: 'UPDATE roles ...',
      DELETE: 'DELETE FROM roles ...',
    },
    ROLE_PERMISSIONS: {
      SELECT_BY_ROLE: 'SELECT * FROM role_permissions WHERE role_id = ?',
      DELETE_ALL_FOR_ROLE: 'DELETE FROM role_permissions WHERE ...',
      INSERT: 'INSERT INTO role_permissions ...',
    },
    TENANT_PROVISION: {
      SELECT_TEMPLATE_ROLES: 'SELECT id, name, description, is_system_role, is_active FROM roles WHERE tenant_id = ?',
      INSERT_ROLE_FULL: 'INSERT INTO roles (id, tenant_id, name, description, is_system_role, is_active) VALUES (?, ?, ?, ?, ?, ?)',
      SELECT_ROLE_FEATURE_IDS: 'SELECT feature_id FROM role_permissions WHERE role_id = ?',
    },
    FEATURES: {
      SELECT_ALL: 'SELECT * FROM features WHERE is_active = TRUE',
      SELECT_BY_ID: 'SELECT * FROM features WHERE feature_id = ?',
      INSERT: 'INSERT INTO features ...',
      UPDATE: 'UPDATE features ...',
      CHECK_IN_USE: 'SELECT COUNT(*) as cnt FROM role_permissions WHERE feature_id = ?',
    },
  },
  ONBOARDING: {
    SETTING_AUTO_APPROVE: 'onboarding.auto_approve.enabled',
    TEMPLATE_TENANT_ID: 'template-tenant',
    AUTO_APPROVE_ROLE: 'TENANT_ADMIN',
    AUTO_REVIEWER: 'system-auto',
  },
}));
jest.mock('../../config/messages', () => ({
  ERROR: {
    USER_ALREADY_EXISTS: 'User already exists in tenant.',
    SYSTEM_ROLE_PROTECTED: 'Cannot modify system roles.',
    FEATURE_IN_USE: 'Feature is in use by one or more roles.',
  },
}));

const service = require('../../modules/admin/admin.service');
const { HttpError } = require('../../middleware/errorHandler');

beforeEach(() => jest.clearAllMocks());

// ─── listOnboardingRequests ───────────────────────────────────────────────────
describe('listOnboardingRequests', () => {
  it('returns data and pagination for PENDING status', async () => {
    mockConn.execute.mockResolvedValueOnce([[{ total: 2 }]]);
    mockConn.query.mockResolvedValueOnce([[{ id: 'r1' }, { id: 'r2' }]]);
    const result = await service.listOnboardingRequests('PENDING', 1, 20);
    expect(result.data).toHaveLength(2);
    expect(result.pagination).toBeDefined();
  });

  it('fetches ALL statuses when status is ALL', async () => {
    mockConn.execute.mockResolvedValueOnce([[{ total: 0 }]]);
    mockConn.query.mockResolvedValueOnce([[]]);
    const result = await service.listOnboardingRequests('ALL', 1, 20);
    expect(result.data).toHaveLength(0);
  });
});

// ─── approveRequest ───────────────────────────────────────────────────────────
describe('approveRequest', () => {
  it('throws 404 when request not found', async () => {
    mockConn.execute.mockResolvedValueOnce([[]]); // no pending request
    await expect(service.approveRequest('req-1', 'tid', [], 'admin@test.com'))
      .rejects.toBeInstanceOf(HttpError);
  });

  it('throws 409 when user already exists in tenant', async () => {
    mockConn.execute
      .mockResolvedValueOnce([[{ id: 'req-1', email: 'u@t.com', name: 'U' }]])
      .mockResolvedValueOnce([[{ id: 'ut-1' }]]); // already exists
    await expect(service.approveRequest('req-1', 'tid', ['role-1'], 'admin@test.com'))
      .rejects.toBeInstanceOf(HttpError);
  });

  it('provisions user, assigns roles, updates request status', async () => {
    mockConn.execute
      .mockResolvedValueOnce([[{ id: 'req-1', email: 'u@t.com', name: 'U' }]])
      .mockResolvedValueOnce([[]])                    // no existing user_tenant
      .mockResolvedValueOnce([{ affectedRows: 1 }])  // INSERT user_tenant
      .mockResolvedValueOnce([{ affectedRows: 1 }])  // INSERT user_role
      .mockResolvedValueOnce([{ affectedRows: 1 }]); // UPDATE onboarding_requests
    const result = await service.approveRequest('req-1', 'tid', ['role-1'], 'admin@test.com');
    expect(result).toMatchObject({ email: 'u@t.com', tenantId: 'tid' });
  });
});

// ─── provisionTenantIam ───────────────────────────────────────────────────────
describe('provisionTenantIam', () => {
  it('clones roles + permissions from the template tenant into the new tenant', async () => {
    mockConn.execute
      .mockResolvedValueOnce([[
        { id: 'tr1', name: 'TENANT_ADMIN', description: 'Admin', is_system_role: 1, is_active: 1 },
        { id: 'tr2', name: 'VIEWER', description: 'Read', is_system_role: 0, is_active: 1 },
      ]])                                            // SELECT_TEMPLATE_ROLES
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // INSERT role TENANT_ADMIN
      .mockResolvedValueOnce([[{ feature_id: 'f1' }]]) // features for TENANT_ADMIN
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // INSERT role_permission f1
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // INSERT role VIEWER
      .mockResolvedValueOnce([[]]);                 // features for VIEWER (none)
    const map = await service.provisionTenantIam(mockConn, 'new-tenant');
    expect(map).toMatchObject({ TENANT_ADMIN: 'mock-uuid', VIEWER: 'mock-uuid' });
  });

  it('throws when the template tenant has no roles', async () => {
    mockConn.execute.mockResolvedValueOnce([[]]);
    await expect(service.provisionTenantIam(mockConn, 'new-tenant'))
      .rejects.toBeInstanceOf(HttpError);
  });
});

// ─── autoApproveOnboarding ────────────────────────────────────────────────────
describe('autoApproveOnboarding', () => {
  it('creates a tenant, bootstraps IAM, and provisions the user as an admin', async () => {
    mockConn.execute
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // INSERT onboarding_requests
      .mockResolvedValueOnce([[{ id: 'tr1', name: 'TENANT_ADMIN', description: 'Admin', is_system_role: 1, is_active: 1 }]]) // template roles
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // INSERT role
      .mockResolvedValueOnce([[]])                  // features for role (none)
      .mockResolvedValueOnce([[]])                  // dup user_tenant check → none
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // INSERT user_tenant (flags)
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // INSERT user_role
      .mockResolvedValueOnce([{ affectedRows: 1 }]); // UPDATE onboarding status
    const result = await service.autoApproveOnboarding({ email: 'new@user.com', name: 'New', googleSub: 'g1' });
    expect(result).toMatchObject({ roleName: 'TENANT_ADMIN' });
    expect(result.tenantId).toBeDefined();
    // user_tenant insert (call index 5) carries is_admin=1
    expect(mockConn.execute.mock.calls[5][1][3]).toBe(1);
  });

  it('throws when the template tenant lacks the TENANT_ADMIN role', async () => {
    mockConn.execute
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // INSERT onboarding_requests
      .mockResolvedValueOnce([[{ id: 'tr1', name: 'VIEWER', description: 'Read', is_system_role: 0, is_active: 1 }]]) // no TENANT_ADMIN
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // INSERT role
      .mockResolvedValueOnce([[]]);                 // features
    await expect(service.autoApproveOnboarding({ email: 'x@y.com', name: 'X' }))
      .rejects.toBeInstanceOf(HttpError);
  });
});

// ─── listRoles ────────────────────────────────────────────────────────────────
describe('listRoles', () => {
  it('returns roles for tenant', async () => {
    mockConn.execute.mockResolvedValueOnce([[{ id: 'r1', name: 'Admin' }]]);
    const roles = await service.listRoles('tenant-1');
    expect(roles).toHaveLength(1);
  });
});

// ─── createRole ───────────────────────────────────────────────────────────────
describe('createRole', () => {
  it('inserts and returns new role', async () => {
    mockConn.execute
      .mockResolvedValueOnce([{ insertId: 1 }])
      .mockResolvedValueOnce([[{ id: 'mock-uuid', name: 'Editor' }]]);
    const role = await service.createRole('tenant-1', 'Editor', 'Can edit records');
    expect(role).toMatchObject({ name: 'Editor' });
  });
});

// ─── deleteRole ───────────────────────────────────────────────────────────────
describe('deleteRole', () => {
  it('throws 404 when role not found', async () => {
    mockConn.execute.mockResolvedValueOnce([[]]); // not found
    await expect(service.deleteRole('role-1', 'tenant-1')).rejects.toBeInstanceOf(HttpError);
  });

  it('throws 403 for system roles', async () => {
    mockConn.execute.mockResolvedValueOnce([[{ id: 'role-1', is_system_role: 1 }]]);
    await expect(service.deleteRole('role-1', 'tenant-1')).rejects.toBeInstanceOf(HttpError);
  });

  it('deletes a non-system role', async () => {
    mockConn.execute
      .mockResolvedValueOnce([[{ id: 'role-1', is_system_role: 0 }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);
    await expect(service.deleteRole('role-1', 'tenant-1')).resolves.toBeUndefined();
  });
});

// ─── getUserRoles ─────────────────────────────────────────────────────────────
describe('getUserRoles', () => {
  it('throws 404 when user is not in tenant', async () => {
    mockConn.execute.mockResolvedValueOnce([[]]); // no user_tenant row
    await expect(service.getUserRoles('u@t.com', 'tenant-1')).rejects.toBeInstanceOf(HttpError);
  });

  it('returns roles array for a provisioned user', async () => {
    mockConn.execute
      .mockResolvedValueOnce([[{ id: 'ut-1' }]])  // user_tenant exists
      .mockResolvedValueOnce([[{ role_id: 'r1', role_name: 'Editor' }, { role_id: 'r2', role_name: 'Viewer' }]]);
    const roles = await service.getUserRoles('u@t.com', 'tenant-1');
    expect(roles).toHaveLength(2);
    expect(roles[0]).toMatchObject({ role_name: 'Editor' });
  });

  it('returns empty array when user has no roles assigned', async () => {
    mockConn.execute
      .mockResolvedValueOnce([[{ id: 'ut-1' }]]) // user_tenant exists
      .mockResolvedValueOnce([[]]); // no roles
    const roles = await service.getUserRoles('u@t.com', 'tenant-1');
    expect(roles).toHaveLength(0);
  });
});

// ─── approveRequest (with empty roleIds — Part 2I approve path) ───────────────
describe('approveRequest with empty roleIds', () => {
  it('provisions user without assigning any roles when roleIds is empty', async () => {
    mockConn.execute
      .mockResolvedValueOnce([[{ id: 'req-1', email: 'u@t.com', name: 'U' }]])
      .mockResolvedValueOnce([[]])                    // no existing user_tenant
      .mockResolvedValueOnce([{ affectedRows: 1 }])  // INSERT user_tenant
      .mockResolvedValueOnce([{ affectedRows: 1 }]); // UPDATE onboarding_requests status
    const result = await service.approveRequest('req-1', 'tid', [], 'admin@test.com');
    expect(result).toMatchObject({ email: 'u@t.com', tenantId: 'tid', roleIds: [] });
  });
});

// ─── rejectRequest (rejectionReason field — Part 2I reject path) ─────────────
describe('rejectRequest with rejectionReason', () => {
  it('rejects a pending request with a custom reason string', async () => {
    mockConn.execute
      .mockResolvedValueOnce([[{ id: 'req-1', email: 'u@t.com' }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);
    await expect(service.rejectRequest('req-1', 'Not eligible at this time.', 'admin@test.com'))
      .resolves.toBeUndefined();
  });

  it('throws 404 when request is not found or already reviewed', async () => {
    mockConn.execute.mockResolvedValueOnce([[]]); // no pending request
    await expect(service.rejectRequest('req-1', 'some reason', 'admin@test.com'))
      .rejects.toBeInstanceOf(HttpError);
  });
});

// ─── listFeatures ─────────────────────────────────────────────────────────────
describe('listFeatures', () => {
  it('returns all active features', async () => {
    mockConn.execute.mockResolvedValueOnce([[{ feature_id: 'f1', scope: 'READ' }]]);
    const features = await service.listFeatures();
    expect(features).toHaveLength(1);
  });
});

// ─── deleteFeature ────────────────────────────────────────────────────────────
describe('deleteFeature', () => {
  it('throws 409 when feature is in use', async () => {
    mockConn.execute.mockResolvedValueOnce([[{ cnt: 3 }]]);
    await expect(service.deleteFeature('feat-1')).rejects.toBeInstanceOf(HttpError);
  });

  it('deletes feature when not in use', async () => {
    mockConn.execute
      .mockResolvedValueOnce([[{ cnt: 0 }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);
    await expect(service.deleteFeature('feat-1')).resolves.toBeUndefined();
  });
});

// ─── listAllUsers (super-admin cross-tenant listing) ──────────────────────────
describe('listAllUsers', () => {
  it('returns users across all tenants with pagination metadata', async () => {
    mockConn.execute.mockResolvedValueOnce([[{ total: 3 }]]); // COUNT_ALL_TENANTS
    mockConn.query.mockResolvedValueOnce([[
      { user_email: 'a@x.com', tenant_id: 't1' },
      { user_email: 'b@y.com', tenant_id: 't2' },
    ]]);
    const result = await service.listAllUsers(1, 20);
    expect(result.data).toHaveLength(2);
    expect(result.pagination.total).toBe(1); // from mocked getPaginationMetadata
  });
});

// ─── updateUserStatusCrossTenant (super-admin suspend/activate) ───────────────
describe('updateUserStatusCrossTenant', () => {
  it('throws 404 when the user is not a member of the target tenant', async () => {
    mockConn.execute.mockResolvedValueOnce([[]]); // SELECT_FLAGS → no row
    await expect(
      service.updateUserStatusCrossTenant('missing@x.com', 't1', 'SUSPENDED')
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('throws 403 when the target user is a super admin', async () => {
    mockConn.execute.mockResolvedValueOnce([[{ is_super_admin: 1 }]]);
    await expect(
      service.updateUserStatusCrossTenant('super@x.com', 't1', 'SUSPENDED')
    ).rejects.toMatchObject({ statusCode: 403 });
    // No UPDATE issued.
    expect(mockConn.execute).toHaveBeenCalledTimes(1);
  });

  it('suspends a normal user (is_active = 0) in the target tenant', async () => {
    mockConn.execute
      .mockResolvedValueOnce([[{ is_super_admin: 0 }]]) // SELECT_FLAGS
      .mockResolvedValueOnce([{ affectedRows: 1 }]);     // UPDATE_STATUS
    await service.updateUserStatusCrossTenant('user@x.com', 't1', 'SUSPENDED');
    const updateCall = mockConn.execute.mock.calls[1];
    expect(updateCall[1]).toEqual([0, 'SUSPENDED', 'user@x.com', 't1']);
  });

  it('activates a normal user (is_active = 1) in the target tenant', async () => {
    mockConn.execute
      .mockResolvedValueOnce([[{ is_super_admin: 0 }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);
    await service.updateUserStatusCrossTenant('user@x.com', 't1', 'ACTIVE');
    const updateCall = mockConn.execute.mock.calls[1];
    expect(updateCall[1]).toEqual([1, 'ACTIVE', 'user@x.com', 't1']);
  });
});
