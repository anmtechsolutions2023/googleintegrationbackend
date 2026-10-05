// src/__tests__/modules/admin.service.test.js

const mockConn = {
  execute: jest.fn(),
  query: jest.fn(),
};

jest.mock('uuid', () => ({ v4: () => 'mock-uuid' }));
// The per-request access cache. Every change of somebody's access must drop
// their entry, which is what these tests check it is told to do.
jest.mock('../../middleware/liveAccess', () => ({ invalidate: jest.fn() }));
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
      SELECT_FLAGS_BY_PHONE_TENANT: 'SELECT is_super_admin FROM user_tenants WHERE user_phone = ? AND tenant_id = ?',
      SELECT_STATE: 'SELECT full_name, branch_detail_id, branch_name, is_admin, is_super_admin, status FROM user_tenants WHERE ...',
      SELECT_BRANCH_NAME: 'SELECT BranchName FROM branchdetail WHERE Id = ? AND TenantId = ?',
      SELECT_ADMINISTRATORS: 'SELECT full_name, user_phone FROM user_tenants WHERE tenant_id = ? AND is_admin = TRUE',
      SELECT_BY_EMAIL: 'SELECT * FROM user_tenants WHERE user_phone = ?',
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
      SELECT_HOLDERS: 'SELECT user_phone, full_name FROM user_roles ... WHERE role_id = ? AND tenant_id = ?',
      COUNT_PENDING_INVITATIONS: 'SELECT COUNT(*) AS total FROM tenant_invitation_roles ...',
    },
    ROLE_PERMISSIONS: {
      SELECT_BY_ROLE: 'SELECT * FROM role_permissions WHERE role_id = ?',
      SELECT_FOR_TENANT: 'SELECT rp.role_id, rp.feature_id FROM role_permissions rp JOIN roles r ... WHERE r.tenant_id = ?',
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
      SELECT_KEYS: 'SELECT feature_id, feature_short_name, scope, is_active FROM features',
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
    SELF_SUSPEND_FORBIDDEN: 'You cannot suspend or deactivate your own account.',
    SELF_REMOVE_FORBIDDEN: 'You cannot remove your own account.',
  },
}));

const service = require('../../modules/admin/admin.service');
const liveAccess = require('../../middleware/liveAccess');
const { HttpError } = require('../../middleware/errorHandler');

beforeEach(() => {
  jest.clearAllMocks();
  // clearAllMocks keeps queued and default values; a test that sets a default
  // must not leak it into the next one.
  mockConn.execute.mockReset();
  mockConn.query.mockReset();
});

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
      .mockResolvedValueOnce([[{ id: 'req-1', phone: '+919876500021', name: 'U' }]])
      .mockResolvedValueOnce([[{ id: 'ut-1' }]]); // already exists
    await expect(service.approveRequest('req-1', 'tid', ['role-1'], 'admin@test.com'))
      .rejects.toBeInstanceOf(HttpError);
  });

  it('provisions user, assigns roles, updates request status', async () => {
    mockConn.execute
      .mockResolvedValueOnce([[{ id: 'req-1', phone: '+919876500021', name: 'U' }]])
      .mockResolvedValueOnce([[]])                    // no existing user_tenant
      .mockResolvedValueOnce([[{ id: 'role-1', name: 'POS_MANAGER' }]]) // roleGuard: the tenancy's rows for those ids
      .mockResolvedValueOnce([{ affectedRows: 1 }])  // INSERT user_tenant
      .mockResolvedValueOnce([{ affectedRows: 1 }])  // INSERT user_role
      .mockResolvedValueOnce([{ affectedRows: 1 }]); // UPDATE onboarding_requests
    const result = await service.approveRequest('req-1', 'tid', ['role-1'], 'admin@test.com');
    expect(result).toMatchObject({ phone: '+919876500021', tenantId: 'tid' });
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
      .mockResolvedValueOnce([[{ id: 'mock-uuid', name: 'TENANT_ADMIN' }]]) // roleGuard: the new tenancy's own role
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // INSERT user_tenant (flags)
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // INSERT user_role
      .mockResolvedValueOnce([{ affectedRows: 1 }]); // UPDATE onboarding status
    const result = await service.autoApproveOnboarding({ phone: '+919876503011', name: 'New', googleSub: 'g1' });
    expect(result).toMatchObject({ roleName: 'TENANT_ADMIN' });
    expect(result.tenantId).toBeDefined();
    // Located by query rather than by call index: the index moved when the role
    // guard added a lookup ahead of the insert, and it will move again.
    const { QUERIES } = require('../../config/constants');
    const insert = mockConn.execute.mock.calls
      .find(([sql]) => sql === QUERIES.ADMIN_USERS.INSERT_USER_TENANT_FLAGS);
    // [id, phone, full_name, tenant_id, is_admin, is_super_admin]
    expect(insert[1][4]).toBe(1);   // is_admin
    expect(insert[1][5]).toBe(0);   // is_super_admin — never 1 from any request
  });

  it('throws when the template tenant lacks the TENANT_ADMIN role', async () => {
    mockConn.execute
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // INSERT onboarding_requests
      .mockResolvedValueOnce([[{ id: 'tr1', name: 'VIEWER', description: 'Read', is_system_role: 0, is_active: 1 }]]) // no TENANT_ADMIN
      .mockResolvedValueOnce([{ affectedRows: 1 }]) // INSERT role
      .mockResolvedValueOnce([[]]);                 // features
    await expect(service.autoApproveOnboarding({ phone: '+919876503011', name: 'X' }))
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

  it('deletes a non-system role that nobody holds', async () => {
    mockConn.execute
      .mockResolvedValueOnce([[{ id: 'role-1', name: 'VIEWER', is_system_role: 0 }]])
      .mockResolvedValueOnce([[]])               // holders: none
      .mockResolvedValueOnce([[{ total: 0 }]])   // pending invitations: none
      .mockResolvedValueOnce([{ affectedRows: 1 }]);
    await expect(service.deleteRole('role-1', 'tenant-1')).resolves.toEqual({ name: 'VIEWER' });
  });

  it('refuses with 409 while somebody holds the role, naming them, and deletes nothing', async () => {
    // user_roles cascades on delete, so this used to succeed and quietly take
    // the role away from everyone holding it.
    mockConn.execute
      .mockResolvedValueOnce([[{ id: 'role-1', name: 'OPERATIONS_STAFF', is_system_role: 0 }]])
      .mockResolvedValueOnce([[{ user_phone: '+919876543211', full_name: 'User211' }]])
      .mockResolvedValueOnce([[{ total: 0 }]]);
    const err = await service.deleteRole('role-1', 'tenant-1').catch((e) => e);
    expect(err).toMatchObject({ statusCode: 409, code: 'ROLE_IN_USE' });
    expect(err.message).toContain('User211');
    expect(err.details).toEqual({ holders: [{ name: 'User211', phone: '+919876543211' }], pendingInvitations: 0 });
    expect(mockConn.execute).toHaveBeenCalledTimes(3);   // no DELETE issued
  });

  it('refuses with 409 while a pending invitation offers the role', async () => {
    mockConn.execute
      .mockResolvedValueOnce([[{ id: 'role-1', name: 'POS_WAITER', is_system_role: 0 }]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[{ total: 2 }]]);
    await expect(service.deleteRole('role-1', 'tenant-1'))
      .rejects.toMatchObject({ statusCode: 409, message: expect.stringContaining('2 pending invitations') });
  });
});

// ─── getRolePermissions ───────────────────────────────────────────────────────
describe('getRolePermissions', () => {
  it('is a 404 for a role that is not in the caller\'s tenancy', async () => {
    // Used to read any role's grants by id alone.
    mockConn.execute.mockResolvedValueOnce([[]]); // SELECT_BY_ID (id AND tenant) → nothing
    await expect(service.getRolePermissions('foreign-role', 'tenant-1'))
      .rejects.toMatchObject({ statusCode: 404 });
    expect(mockConn.execute).toHaveBeenCalledTimes(1);
    expect(mockConn.execute.mock.calls[0][1]).toEqual(['foreign-role', 'tenant-1']);
  });

  it('returns the grants of the caller\'s own role', async () => {
    mockConn.execute
      .mockResolvedValueOnce([[{ id: 'r1' }]])
      .mockResolvedValueOnce([[{ feature_id: 'f1' }]]);
    await expect(service.getRolePermissions('r1', 'tenant-1')).resolves.toEqual([{ feature_id: 'f1' }]);
  });
});

// ─── setRolePermissions ───────────────────────────────────────────────────────
describe('setRolePermissions', () => {
  const CATALOGUE = [
    { feature_id: 'f-order-r', feature_short_name: 'POS_ORDER', scope: 'READ', is_active: 1 },
    { feature_id: 'f-order-w', feature_short_name: 'POS_ORDER', scope: 'WRITE', is_active: 1 },
    { feature_id: 'f-ops-r', feature_short_name: 'POS_OPS', scope: 'READ', is_active: 1 },
    { feature_id: 'f-exp-a', feature_short_name: 'EXPENSE', scope: 'APPROVE', is_active: 1 },
  ];

  it('refuses a system role with 403 — its grants are fixed', async () => {
    mockConn.execute.mockResolvedValueOnce([[{ id: 'r1', name: 'TENANT_ADMIN', is_system_role: 1 }]]);
    await expect(service.setRolePermissions('r1', 'tenant-1', ['f-order-r']))
      .rejects.toMatchObject({ statusCode: 403 });
    expect(mockConn.execute).toHaveBeenCalledTimes(1);   // nothing deleted or inserted
  });

  it('refuses an unknown feature id with 400', async () => {
    mockConn.execute
      .mockResolvedValueOnce([[{ id: 'r1', name: 'CUSTOM', is_system_role: 0 }]])
      .mockResolvedValueOnce([CATALOGUE]);
    await expect(service.setRolePermissions('r1', 'tenant-1', ['no-such-feature']))
      .rejects.toMatchObject({ statusCode: 400 });
  });

  it('adds what a choice requires: Manage brings View, approval brings the screen it is made from', async () => {
    mockConn.execute
      .mockResolvedValueOnce([[{ id: 'r1', name: 'CUSTOM', is_system_role: 0 }]])
      .mockResolvedValueOnce([CATALOGUE])
      .mockResolvedValueOnce([[]])                       // currently grants nothing
      .mockResolvedValue([{ affectedRows: 1 }]);         // DELETE + INSERTs
    const change = await service.setRolePermissions('r1', 'tenant-1', ['f-order-w', 'f-exp-a']);
    expect(change.role).toBe('CUSTOM');
    expect(change.implied).toEqual(['POS_OPS:READ', 'POS_ORDER:READ']);
    expect(change.added).toEqual(['EXPENSE:APPROVE', 'POS_OPS:READ', 'POS_ORDER:READ', 'POS_ORDER:WRITE']);
    const inserted = mockConn.execute.mock.calls
      .filter(([sql]) => sql === 'INSERT INTO role_permissions ...')
      .map(([, params]) => params[2]);
    expect(inserted.sort()).toEqual(['f-exp-a', 'f-ops-r', 'f-order-r', 'f-order-w']);
    expect(liveAccess.invalidate).toHaveBeenCalledWith('tenant-1');
  });

  it('reports what was removed', async () => {
    mockConn.execute
      .mockResolvedValueOnce([[{ id: 'r1', name: 'CUSTOM', is_system_role: 0 }]])
      .mockResolvedValueOnce([CATALOGUE])
      .mockResolvedValueOnce([[{ feature_short_name: 'POS_OPS', scope: 'READ' }]])
      .mockResolvedValue([{ affectedRows: 1 }]);
    const change = await service.setRolePermissions('r1', 'tenant-1', ['f-order-r']);
    expect(change).toMatchObject({ added: ['POS_ORDER:READ'], removed: ['POS_OPS:READ'], implied: [] });
  });
});

// ─── listRolePermissionMatrix / listAdministrators ────────────────────────────
describe('tenancy-wide reads', () => {
  it('reads every grant of the tenancy in one query', async () => {
    mockConn.execute.mockResolvedValueOnce([[{ role_id: 'r1', feature_id: 'f1' }]]);
    await expect(service.listRolePermissionMatrix('tenant-1')).resolves.toEqual([{ role_id: 'r1', feature_id: 'f1' }]);
    expect(mockConn.execute.mock.calls[0][1]).toEqual(['tenant-1']);
  });

  it('names the administrators, and nothing more', async () => {
    mockConn.execute.mockResolvedValueOnce([[{ full_name: 'Owner', user_phone: '+919876543210' }, { full_name: null, user_phone: '+919876543299' }]]);
    await expect(service.listAdministrators('tenant-1')).resolves.toEqual([
      { name: 'Owner', phone: '+919876543210' },
      { name: null, phone: '+919876543299' },
    ]);
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
      .mockResolvedValueOnce([[{ id: 'req-1', phone: '+919876503011', name: 'U' }]])
      .mockResolvedValueOnce([[]])                    // no existing user_tenant
      .mockResolvedValueOnce([{ affectedRows: 1 }])  // INSERT user_tenant
      .mockResolvedValueOnce([{ affectedRows: 1 }]); // UPDATE onboarding_requests status
    const result = await service.approveRequest('req-1', 'tid', [], 'admin@test.com');
    expect(result).toMatchObject({ phone: '+919876503011', tenantId: 'tid', roleIds: [] });
  });
});

// ─── rejectRequest (rejectionReason field — Part 2I reject path) ─────────────
describe('rejectRequest with rejectionReason', () => {
  it('rejects a pending request with a custom reason string', async () => {
    mockConn.execute
      .mockResolvedValueOnce([[{ id: 'req-1', phone: '+919876503011' }]])
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
      { user_phone: 'a@x.com', tenant_id: 't1' },
      { user_phone: 'b@y.com', tenant_id: 't2' },
    ]]);
    const result = await service.listAllUsers(1, 20);
    expect(result.data).toHaveLength(2);
    expect(result.pagination.total).toBe(1); // from mocked getPaginationMetadata
  });

  it('passes through the per-tenant setup status used by the tracking column', async () => {
    mockConn.execute.mockResolvedValueOnce([[{ total: 1 }]]);
    mockConn.query.mockResolvedValueOnce([[
      { user_phone: 'a@x.com', tenant_id: 't1', setup_status: 'COMPLETED' },
    ]]);

    const result = await service.listAllUsers(1, 20);
    expect(result.data[0].setup_status).toBe('COMPLETED');
  });

  // This suite stubs QUERIES, so the SQL text itself is asserted against the
  // real constants module — otherwise the assertion would only prove the mock.
  it('the real cross-tenant query joins tenant_setup and defaults to PENDING', () => {
    const { QUERIES } = jest.requireActual('../../config/constants');
    const sql = QUERIES.ADMIN_USERS.SELECT_ALL_TENANTS;

    expect(sql).toContain('LEFT JOIN tenant_setup ts ON ts.tenant_id = ut.tenant_id');
    // A tenant with no tenant_setup row must report PENDING, not null.
    expect(sql).toContain("COALESCE(ts.status, 'PENDING') AS setup_status");
    // Grouped columns must include the joined ones under ONLY_FULL_GROUP_BY.
    expect(sql).toContain('GROUP BY ut.user_phone, ut.tenant_id, ts.status, ts.completed_at');
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

  it('throws 403 before any query when a super admin suspends themselves', async () => {
    await expect(
      service.updateUserStatusCrossTenant('me@x.com', 't1', 'SUSPENDED', 'me@x.com')
    ).rejects.toMatchObject({ statusCode: 403 });
    // Guard runs ahead of the membership lookup — no DB access at all.
    expect(mockConn.execute).not.toHaveBeenCalled();
  });

  it('rejects cross-tenant self-suspend regardless of email casing', async () => {
    await expect(
      service.updateUserStatusCrossTenant('Me@X.com', 't1', 'SUSPENDED', ' me@x.com ')
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(mockConn.execute).not.toHaveBeenCalled();
  });

  it('still allows a super admin to activate their own membership', async () => {
    mockConn.execute
      .mockResolvedValueOnce([[{ is_super_admin: 0 }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);
    await service.updateUserStatusCrossTenant('me@x.com', 't1', 'ACTIVE', 'me@x.com');
    const updateCall = mockConn.execute.mock.calls[1];
    expect(updateCall[1]).toEqual([1, 'ACTIVE', 'me@x.com', 't1']);
  });
});

// ─── updateUserStatus (tenant-scoped suspend/activate) ────────────────────────
describe('updateUserStatus', () => {
  // Each change reads the membership first: its current status is the "before"
  // of the audit row, and a missing member is a 404 rather than a silent no-op.
  const member = (status = 'ACTIVE') => mockConn.execute
    .mockResolvedValueOnce([[{ status }]])          // SELECT_STATE
    .mockResolvedValueOnce([{ affectedRows: 1 }]);   // UPDATE_STATUS

  it('suspends another user in the tenant (is_active = 0), reporting before → after', async () => {
    member('ACTIVE');
    const change = await service.updateUserStatus('user@x.com', 't1', 'SUSPENDED', 'admin@x.com');
    expect(mockConn.execute.mock.calls[1][1]).toEqual([0, 'SUSPENDED', 'user@x.com', 't1']);
    expect(change).toEqual({ before: 'ACTIVE', after: 'SUSPENDED' });
    expect(liveAccess.invalidate).toHaveBeenCalledWith('t1', 'user@x.com');
  });

  it('activates another user in the tenant (is_active = 1)', async () => {
    member('SUSPENDED');
    await service.updateUserStatus('user@x.com', 't1', 'ACTIVE', 'admin@x.com');
    expect(mockConn.execute.mock.calls[1][1]).toEqual([1, 'ACTIVE', 'user@x.com', 't1']);
  });

  it('is a 404 for somebody who is not a member here', async () => {
    mockConn.execute.mockResolvedValueOnce([[]]);
    await expect(service.updateUserStatus('nobody@x.com', 't1', 'SUSPENDED', 'admin@x.com'))
      .rejects.toMatchObject({ statusCode: 404 });
    expect(liveAccess.invalidate).not.toHaveBeenCalled();
  });

  it('throws 403 and issues no UPDATE when an admin suspends themselves', async () => {
    await expect(
      service.updateUserStatus('admin@x.com', 't1', 'SUSPENDED', 'admin@x.com')
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(mockConn.execute).not.toHaveBeenCalled();
  });

  it('rejects self-suspend regardless of email casing or surrounding whitespace', async () => {
    await expect(
      service.updateUserStatus('Admin@X.com', 't1', 'SUSPENDED', ' admin@x.com ')
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(mockConn.execute).not.toHaveBeenCalled();
  });

  it('allows an admin to activate their own account (harmless no-op)', async () => {
    member('ACTIVE');
    await service.updateUserStatus('admin@x.com', 't1', 'ACTIVE', 'admin@x.com');
    expect(mockConn.execute.mock.calls[1][1]).toEqual([1, 'ACTIVE', 'admin@x.com', 't1']);
  });

  it('preserves legacy behaviour when no actor email is supplied', async () => {
    member('ACTIVE');
    await service.updateUserStatus('user@x.com', 't1', 'SUSPENDED');
    expect(mockConn.execute).toHaveBeenCalledTimes(2);
  });
});

// ─── removeUser (tenant-scoped removal) ───────────────────────────────────────
describe('removeUser', () => {
  it('deletes role assignments then the membership, and reports the roles they held', async () => {
    mockConn.execute
      .mockResolvedValueOnce([[{ role_name: 'POS_WAITER' }, { role_name: 'POS_CASHIER' }]]) // roles held
      .mockResolvedValueOnce([{ affectedRows: 2 }]) // DELETE_ALL_FOR_USER
      .mockResolvedValueOnce([{ affectedRows: 1 }]); // ADMIN_USERS.DELETE
    const result = await service.removeUser('user@x.com', 't1', 'admin@x.com');
    expect(result).toEqual({ roles: ['POS_CASHIER', 'POS_WAITER'] });
    expect(mockConn.execute).toHaveBeenCalledTimes(3);
    expect(mockConn.execute.mock.calls[1][1]).toEqual(['user@x.com', 't1']);
    expect(mockConn.execute.mock.calls[2][1]).toEqual(['user@x.com', 't1']);
    expect(liveAccess.invalidate).toHaveBeenCalledWith('t1', 'user@x.com');
  });

  it('throws 403 and opens no transaction when an admin removes themselves', async () => {
    await expect(
      service.removeUser('admin@x.com', 't1', 'admin@x.com')
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(mockConn.execute).not.toHaveBeenCalled();
  });

  it('rejects self-removal regardless of email casing', async () => {
    await expect(
      service.removeUser('ADMIN@x.com', 't1', 'admin@X.com')
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(mockConn.execute).not.toHaveBeenCalled();
  });

  it('preserves legacy behaviour when no actor email is supplied', async () => {
    mockConn.execute
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([{ affectedRows: 0 }])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);
    await service.removeUser('user@x.com', 't1');
    expect(mockConn.execute).toHaveBeenCalledTimes(3);
  });
});
