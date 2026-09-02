// src/modules/admin/admin.service.js
// Business logic for onboarding approval, user management, role management,
// and feature/scope management. All write operations use transactions.

const { v4: uuidv4 } = require('uuid');
const { withConnection, withTransaction } = require('../../utils/dbHelper');
const { QUERIES, ONBOARDING } = require('../../config/constants');
const { HttpError } = require('../../middleware/errorHandler');
const { assertRolesGrantable } = require('../../utils/roleGuard');
const MESSAGES = require('../../config/messages');
const { logger } = require('../../utils/logger');
const {
  calculatePagination,
  getPaginationMetadata,
} = require('../../utils/paginationHelper');

// ─── ONBOARDING APPROVAL ──────────────────────────────────────────────────────

const listOnboardingRequests = (status = 'PENDING', page = 1, limit = 20) =>
  withConnection(async (conn) => {
    const { pageNum, limitNum, offset } = calculatePagination(page, limit);

    const whereClause = status !== 'ALL' ? ' AND status = ?' : '';
    const countParams = status !== 'ALL' ? [status] : [];
    const [[{ total }]] = await conn.execute(
      `SELECT COUNT(*) as total FROM onboarding_requests WHERE 1=1${whereClause}`,
      countParams
    );

    const dataParams = status !== 'ALL' ? [status] : [];
    // Newest first: an approvals queue should surface the most recent requests
    // (incl. just auto-approved ones) on page 1 rather than truncating them off
    // the end under the default page size.
    const [rows] = await conn.query(
      `${QUERIES.ONBOARDING_REQUESTS.SELECT_ALL}${whereClause} ORDER BY requested_at DESC LIMIT ${limitNum} OFFSET ${offset}`,
      dataParams
    );

    return { data: rows, pagination: getPaginationMetadata(total, pageNum, limitNum) };
  });

/**
 * Shared provisioning core: adds an approved user to a tenant and marks their
 * onboarding request APPROVED. Runs on a caller-supplied transaction connection
 * so both the manual admin approval and the auto-approver reuse one code path.
 * @param {Object} conn - Active transaction connection.
 * @param {Object} p
 * @param {string} [p.requestId] - Onboarding request to mark APPROVED (optional).
 * @param {string} p.email
 * @param {string} p.tenantId
 * @param {string[]} p.roleIds
 * @param {string} p.reviewerEmail
 * @param {boolean} [p.isAdmin=false] - Whether to grant the tenant-admin flag.
 */
const provisionApprovedUser = async (
  conn,
  { requestId, email, tenantId, roleIds, reviewerEmail, isAdmin = false }
) => {
  const [existing] = await conn.execute(
    'SELECT id FROM user_tenants WHERE user_email = ? AND tenant_id = ?',
    [email, tenantId]
  );
  if (existing.length > 0) {
    throw new HttpError(MESSAGES.ERROR.USER_ALREADY_EXISTS, 409);
  }

  // Refused before the membership exists, so a rejected approval leaves nothing
  // behind. Covers manual approval and auto-approval both — they share this core.
  await assertRolesGrantable(conn, roleIds, tenantId);

  await conn.execute(QUERIES.ADMIN_USERS.INSERT_USER_TENANT_FLAGS, [
    uuidv4(),
    email,
    tenantId,
    isAdmin ? 1 : 0,
    // is_super_admin is hardcoded 0 here and in invitation acceptance: the
    // platform owner is established by the seed and no request can create a
    // second one.
    0,
  ]);

  for (const roleId of roleIds) {
    await conn.execute(QUERIES.USER_ROLES.INSERT, [
      uuidv4(),
      email,
      tenantId,
      roleId,
      reviewerEmail,
    ]);
  }

  if (requestId) {
    await conn.execute(QUERIES.ONBOARDING_REQUESTS.UPDATE_STATUS, [
      'APPROVED',
      null,
      reviewerEmail,
      tenantId,
      requestId,
    ]);
  }
};

/**
 * Clones the standard role catalog (+ their permissions) from a template tenant
 * into a brand-new tenant, so an auto-created tenant has a full IAM setup.
 * Features are global; only roles + role_permissions are per-tenant.
 * @param {Object} conn - Active transaction connection.
 * @param {string} newTenantId - Tenant to populate.
 * @param {string} [templateTenantId] - Source tenant (defaults to the seeded one).
 * @returns {Promise<Object>} Map of roleName → new roleId for the new tenant.
 */
const provisionTenantIam = async (
  conn,
  newTenantId,
  templateTenantId = ONBOARDING.TEMPLATE_TENANT_ID
) => {
  const [templateRoles] = await conn.execute(
    QUERIES.TENANT_PROVISION.SELECT_TEMPLATE_ROLES,
    [templateTenantId]
  );
  if (templateRoles.length === 0) {
    throw new HttpError(
      'Cannot provision new tenant: template tenant has no roles.',
      500
    );
  }

  const roleIdByName = {};
  for (const tr of templateRoles) {
    const newRoleId = uuidv4();
    await conn.execute(QUERIES.TENANT_PROVISION.INSERT_ROLE_FULL, [
      newRoleId,
      newTenantId,
      tr.name,
      tr.description,
      tr.is_system_role,
      tr.is_active,
    ]);
    roleIdByName[tr.name] = newRoleId;

    const [perms] = await conn.execute(
      QUERIES.TENANT_PROVISION.SELECT_ROLE_FEATURE_IDS,
      [tr.id]
    );
    for (const perm of perms) {
      await conn.execute(QUERIES.ROLE_PERMISSIONS.INSERT, [
        uuidv4(),
        newRoleId,
        perm.feature_id,
      ]);
    }
  }
  return roleIdByName;
};

const approveRequest = (requestId, tenantId, roleIds, reviewerEmail) =>
  withTransaction(async (conn) => {
    const [reqRows] = await conn.execute(
      "SELECT * FROM onboarding_requests WHERE id = ? AND status = 'PENDING'",
      [requestId]
    );
    if (reqRows.length === 0) {
      throw new HttpError('Onboarding request not found or already reviewed.', 404);
    }
    const { email, name } = reqRows[0];

    await provisionApprovedUser(conn, {
      requestId,
      email,
      tenantId,
      roleIds,
      reviewerEmail,
      isAdmin: false,
    });

    return { email, name, tenantId, roleIds };
  });

/**
 * Auto-approves a brand-new (unprovisioned) email: creates a new tenant, clones
 * the standard IAM catalog into it, provisions the user as its TENANT_ADMIN, and
 * marks a fresh onboarding request APPROVED — all in one transaction. Called
 * from the auth guest path when the super-admin has enabled auto-approval.
 * @param {Object} p - { email, name, googleSub }
 * @returns {Promise<Object>} { tenantId, requestId, roleName }
 */
const autoApproveOnboarding = ({ email, name, googleSub }) =>
  withTransaction(async (conn) => {
    const newTenantId = uuidv4();
    const requestId = uuidv4();

    await conn.execute(QUERIES.ONBOARDING_REQUESTS.INSERT, [
      requestId,
      email,
      name,
      googleSub || null,
    ]);

    const roleIdByName = await provisionTenantIam(conn, newTenantId);
    const adminRoleId = roleIdByName[ONBOARDING.AUTO_APPROVE_ROLE];
    if (!adminRoleId) {
      throw new HttpError(
        `Template tenant is missing the '${ONBOARDING.AUTO_APPROVE_ROLE}' role.`,
        500
      );
    }

    await provisionApprovedUser(conn, {
      requestId,
      email,
      tenantId: newTenantId,
      roleIds: [adminRoleId],
      reviewerEmail: ONBOARDING.AUTO_REVIEWER,
      isAdmin: true,
    });

    logger.info('Onboarding auto-approved into new tenant', {
      email,
      tenantId: newTenantId,
    });
    return { tenantId: newTenantId, requestId, roleName: ONBOARDING.AUTO_APPROVE_ROLE };
  });

const rejectRequest = (requestId, reason, reviewerEmail) =>
  withConnection(async (conn) => {
    const [reqRows] = await conn.execute(
      "SELECT * FROM onboarding_requests WHERE id = ? AND status = 'PENDING'",
      [requestId]
    );
    if (reqRows.length === 0) {
      throw new HttpError('Onboarding request not found or already reviewed.', 404);
    }
    await conn.execute(QUERIES.ONBOARDING_REQUESTS.UPDATE_STATUS, [
      'REJECTED',
      reason,
      reviewerEmail,
      null,
      requestId,
    ]);
  });

// Reopen a previously REJECTED request, returning it to PENDING for another review.
// Only REJECTED requests can be reopened; the prior review metadata is cleared.
const reopenRequest = (requestId, reviewerEmail) =>
  withConnection(async (conn) => {
    const [reqRows] = await conn.execute(
      "SELECT * FROM onboarding_requests WHERE id = ? AND status = 'REJECTED'",
      [requestId]
    );
    if (reqRows.length === 0) {
      throw new HttpError('Rejected onboarding request not found.', 404);
    }
    await conn.execute(
      `UPDATE onboarding_requests
         SET status = 'PENDING', rejection_reason = NULL,
             reviewed_by = NULL, reviewed_at = NULL, tenant_id = NULL,
             updated_at = NOW()
       WHERE id = ?`,
      [requestId]
    );
    void reviewerEmail; // reviewer captured via audit log, not persisted on the row
  });

// ─── USER MANAGEMENT ──────────────────────────────────────────────────────────

const listUsers = (tenantId, page = 1, limit = 20) =>
  withConnection(async (conn) => {
    const { pageNum, limitNum, offset } = calculatePagination(page, limit);
    const [[{ total }]] = await conn.execute(
      'SELECT COUNT(*) as total FROM user_tenants WHERE tenant_id = ?',
      [tenantId]
    );
    const [rows] = await conn.query(
      `${QUERIES.ADMIN_USERS.SELECT_ALL} LIMIT ${limitNum} OFFSET ${offset}`,
      [tenantId]
    );
    return { data: rows, pagination: getPaginationMetadata(total, pageNum, limitNum) };
  });

// Super-admin-only cross-tenant listing: every user_tenants row across all
// tenants. Not tenant-scoped — gated at the route by TENANT:SUPER_ADMIN.
const listAllUsers = (page = 1, limit = 20) =>
  withConnection(async (conn) => {
    const { pageNum, limitNum, offset } = calculatePagination(page, limit);
    const [[{ total }]] = await conn.execute(QUERIES.ADMIN_USERS.COUNT_ALL_TENANTS);
    const [rows] = await conn.query(
      `${QUERIES.ADMIN_USERS.SELECT_ALL_TENANTS} LIMIT ${limitNum} OFFSET ${offset}`
    );
    return { data: rows, pagination: getPaginationMetadata(total, pageNum, limitNum) };
  });

/**
 * Every tenancy on the platform, one row each, with its own totals.
 *
 * Super admin only. This is the only view that can answer questions which are
 * invisible from inside a single tenancy — most usefully "which tenancies have
 * no admin at all", where nobody there can invite staff, assign a role or open
 * Access & Staff, and only somebody outside can see it.
 *
 * Paginated by TENANCY, not by membership. listAllUsers below pages the flat
 * membership list, which cannot be grouped for display: a page boundary can
 * fall inside a tenancy and split its people across two pages.
 *
 * @param {number} [page]
 * @param {number} [limit]
 * @returns {Promise<{data: Array, pagination: Object}>}
 */
const listTenants = (page = 1, limit = 20) =>
  withConnection(async (conn) => {
    const { pageNum, limitNum, offset } = calculatePagination(page, limit);
    const [[{ total }]] = await conn.execute(QUERIES.ADMIN_USERS.COUNT_TENANTS);
    const [rows] = await conn.query(
      `${QUERIES.ADMIN_USERS.SELECT_TENANT_DIRECTORY} LIMIT ${limitNum} OFFSET ${offset}`
    );
    return { data: rows, pagination: getPaginationMetadata(total, pageNum, limitNum) };
  });

/**
 * The people in ONE tenancy, named, for the cross-tenant directory.
 *
 * Super admin only, and deliberately read-only: it takes the tenancy as an
 * argument rather than reading req.user.tid, which every other user query does.
 * That is the whole difference between this and listUsers, and it is why the
 * route is on the super-admin guard — a tenant admin passing another tenancy's
 * id here would be reading somebody else's staff list.
 *
 * Returns an empty array for a tenancy with no memberships rather than a 404:
 * "this tenancy has nobody in it" is an answer, and one worth seeing.
 *
 * @param {string} tenantId
 * @returns {Promise<Array>}
 */
const listUsersInTenant = (tenantId) =>
  withConnection(async (conn) => {
    const [rows] = await conn.execute(QUERIES.ADMIN_USERS.SELECT_BY_TENANT, [tenantId]);
    return rows;
  });

const getUserDetail = (email, tenantId) =>
  withConnection(async (conn) => {
    const [rows] = await conn.execute(QUERIES.ADMIN_USERS.SELECT_BY_EMAIL, [
      email,
      tenantId,
    ]);
    if (rows.length === 0) throw new HttpError('User not found in tenant.', 404);
    const [roleRows] = await conn.execute(
      QUERIES.USER_ROLES.SELECT_BY_USER_TENANT,
      [email, tenantId]
    );
    return { ...rows[0], roleDetails: roleRows };
  });

const updateUserRoles = (email, tenantId, roleIds, adminEmail) =>
  withTransaction(async (conn) => {
    // An admin must not edit their own roles. Role assignment REPLACES the set,
    // so one save with the wrong boxes ticked strips their own access to the
    // business modules — and, unlike suspension, nothing about the resulting
    // state tells them why. Same family of guard as assertNotSelfSuspend and
    // assertNotSelfRemove; their tenant-admin access is unaffected either way,
    // because that comes from the membership flag rather than from a role.
    if (isSameUser(email, adminEmail)) {
      throw new HttpError(MESSAGES.ERROR.SELF_ROLE_CHANGE_FORBIDDEN, 403);
    }

    const [check] = await conn.execute(
      'SELECT id FROM user_tenants WHERE user_email = ? AND tenant_id = ?',
      [email, tenantId]
    );
    if (check.length === 0) throw new HttpError('User not found in tenant.', 404);

    // Checked BEFORE the existing set is cleared — a refused save must not leave
    // the user with no roles at all.
    await assertRolesGrantable(conn, roleIds, tenantId);

    await conn.execute(QUERIES.USER_ROLES.DELETE_ALL_FOR_USER, [email, tenantId]);
    for (const roleId of roleIds) {
      await conn.execute(QUERIES.USER_ROLES.INSERT, [
        uuidv4(),
        email,
        tenantId,
        roleId,
        adminEmail,
      ]);
    }
  });

// Emails are compared case-insensitively: the JWT claim and the path/body value
// can differ in casing for the same account.
const isSameUser = (a, b) =>
  !!a && !!b && String(a).trim().toLowerCase() === String(b).trim().toLowerCase();

// Self-service lockout guards. An admin must not be able to suspend or remove
// their own account — either would revoke their own access with no way back in.
// Self-ACTIVATE stays allowed: it is a harmless no-op for an already-active
// caller. actorEmail is optional so the guard degrades to today's behaviour if
// a caller does not supply it.
const assertNotSelfSuspend = (email, actorEmail, status) => {
  if (status !== 'ACTIVE' && isSameUser(email, actorEmail)) {
    throw new HttpError(MESSAGES.ERROR.SELF_SUSPEND_FORBIDDEN, 403);
  }
};

const assertNotSelfRemove = (email, actorEmail) => {
  if (isSameUser(email, actorEmail)) {
    throw new HttpError(MESSAGES.ERROR.SELF_REMOVE_FORBIDDEN, 403);
  }
};

const updateUserStatus = async (email, tenantId, status, actorEmail) => {
  assertNotSelfSuspend(email, actorEmail, status);
  return withConnection(async (conn) => {
    const isActive = status === 'ACTIVE' ? 1 : 0;
    await conn.execute(QUERIES.ADMIN_USERS.UPDATE_STATUS, [
      isActive,
      status,
      email,
      tenantId,
    ]);
  });
};

// Super-admin-only: suspend/activate a user in ANY tenant (SUSPENDED blocks
// login because USER_TENANTS.SELECT filters is_active = TRUE). Guards against
// suspending yourself, and against disabling any super admin, to avoid a
// system lockout.
const updateUserStatusCrossTenant = async (email, tenantId, status, actorEmail) => {
  assertNotSelfSuspend(email, actorEmail, status);
  return withConnection(async (conn) => {
    const [rows] = await conn.execute(
      QUERIES.ADMIN_USERS.SELECT_FLAGS_BY_EMAIL_TENANT,
      [email, tenantId]
    );
    if (rows.length === 0) throw new HttpError('User not found in tenant.', 404);
    if (rows[0].is_super_admin) {
      throw new HttpError('Super admins cannot be suspended.', 403);
    }
    const isActive = status === 'ACTIVE' ? 1 : 0;
    await conn.execute(QUERIES.ADMIN_USERS.UPDATE_STATUS, [
      isActive,
      status,
      email,
      tenantId,
    ]);
  });
};

/**
 * Update the staff details on a membership.
 *
 * These live on user_tenants because a member of a tenancy IS a staff member —
 * there is no longer a separate roster to keep in step. They are per-MEMBERSHIP
 * rather than per-person: the same human may be 'Priya (Head Chef, Central)'
 * here and 'Priya (Owner)' in another tenancy, and each tenancy owns its own
 * view of them.
 *
 * Deliberately separate from role assignment and from the admin flag: what
 * somebody is CALLED, what they may DO, and whether they may ADMINISTER are
 * three different decisions with three different risks. A cashier correcting a
 * phone number should not go anywhere near a permission.
 *
 * @param {string} email
 * @param {string} tenantId - The caller's own tenancy.
 * @param {Object} profile - { fullName, phone, branchDetailId }
 * @param {string} actorEmail
 */
const updateUserProfile = (email, tenantId, profile, actorEmail) =>
  withConnection(async (conn) => {
    const [rows] = await conn.execute(
      'SELECT id FROM user_tenants WHERE user_email = ? AND tenant_id = ?',
      [email, tenantId],
    );
    if (rows.length === 0) throw new HttpError('User not found in tenant.', 404);

    const { fullName = null, phone = null, branchDetailId = null } = profile || {};
    await conn.execute(QUERIES.ADMIN_USERS.UPDATE_PROFILE, [
      fullName, phone, branchDetailId, email, tenantId,
    ]);
    logger.info('Staff profile updated', { email, tenantId, actorEmail });
  });

/**
 * Grant or withdraw tenant-administrator access for one membership.
 *
 * Exists because TENANT:ADMIN is derived from user_tenants.is_admin at login and
 * NEVER from a role. Assigning a role named 'TENANT_ADMIN' or 'SUPER_ADMIN'
 * grants that role's feature scopes and nothing more — which is why a user
 * could hold the SUPER_ADMIN role, gain all 29 business scopes, and still be
 * refused the Access Control screen.
 *
 * Deriving the flag from role NAMES was the alternative and is rejected: roles
 * are per-tenant and freely renamable, so a tenant renaming its 'SUPER_ADMIN'
 * role would silently revoke administration for everyone holding it.
 *
 * is_super_admin is deliberately NOT settable here. It bypasses every scope
 * check in checkScope and reaches across tenancies, so it stays a deployment
 * decision made in the seed, not something an API can hand out.
 *
 * @param {string} email - The member whose access is changing.
 * @param {string} tenantId - Always the caller's own tenancy.
 * @param {boolean} isAdmin
 * @param {string} actorEmail
 */
const setTenantAdmin = async (email, tenantId, isAdmin, actorEmail) => {
  // Same reasoning as assertNotSelfSuspend: an admin who withdraws their own
  // access has no way to restore it.
  if (!isAdmin && isSameUser(email, actorEmail)) {
    throw new HttpError(MESSAGES.ERROR.SELF_DEMOTE_FORBIDDEN, 403);
  }

  return withConnection(async (conn) => {
    const [rows] = await conn.execute(
      'SELECT is_super_admin FROM user_tenants WHERE user_email = ? AND tenant_id = ?',
      [email, tenantId],
    );
    if (rows.length === 0) throw new HttpError('User not found in tenant.', 404);
    // A super admin already passes every check via the bypass; toggling their
    // tenant-admin flag would be meaningless at best and misleading at worst.
    if (rows[0].is_super_admin) {
      throw new HttpError(MESSAGES.ERROR.SUPER_ADMIN_IMMUTABLE, 403);
    }

    await conn.execute(QUERIES.ADMIN_USERS.SET_ADMIN_FLAG, [
      isAdmin ? 1 : 0, email, tenantId,
    ]);
    logger.info('Tenant admin access changed', { email, tenantId, isAdmin, actorEmail });
  });
};

const removeUser = async (email, tenantId, actorEmail) => {
  assertNotSelfRemove(email, actorEmail);
  return withTransaction(async (conn) => {
    await conn.execute(QUERIES.USER_ROLES.DELETE_ALL_FOR_USER, [email, tenantId]);
    await conn.execute(QUERIES.ADMIN_USERS.DELETE, [email, tenantId]);
  });
};

/**
 * Erases a tenancy and everything recorded under it.
 *
 * Hard delete, by design and by request: 72 tables in the fixed dependency
 * order of QUERIES.TENANT_DELETE.SWEEP, all inside one transaction, so the
 * tenancy either goes completely or not at all. There is no soft-delete flag
 * to fall back on and no export — the ledger, the bills and the audit trail go
 * with it.
 *
 * WHAT HAPPENS TO THE PEOPLE. There is no `users` table in this schema: a
 * person exists only as user_tenants rows behind a Google account nobody here
 * owns. So "delete the tenancy but not the multi-tenant user" is not a special
 * case that needs building — removing the membership IS disassociation, and it
 * is all the sweep can do. The only thing that genuinely differs between a
 * member who belongs elsewhere and one who does not is a single row in
 * onboarding_requests, which is keyed UNIQUE(email) and therefore platform-wide
 * rather than per tenancy. See DELETE_ONBOARDING_BY_EMAIL for what leaving it
 * behind does to somebody's next sign-in.
 *
 * Both member lists are read BEFORE the sweep, because user_tenants is deleted
 * partway through it and is the only record of who belonged here.
 *
 * @param {string} tenantId - The tenancy to erase.
 * @param {string} actorTenantId - The caller's own tenancy, refused as a target.
 * @returns {Promise<Object>} { tenantId, membersRemoved, accountsReset, disassociated }
 */
const deleteTenant = async (tenantId, actorTenantId) => {
  // Refused before the transaction opens: deleting the tenancy the caller is
  // signed in to revokes the membership their own token is built from, halfway
  // through the request that is doing it. Same instinct as assertNotSelfRemove,
  // one level up.
  if (tenantId === actorTenantId) {
    throw new HttpError(MESSAGES.ERROR.TENANT_DELETE_SELF_FORBIDDEN, 403);
  }

  return withTransaction(async (conn) => {
    const [[{ total: memberships }]] = await conn.execute(
      QUERIES.TENANT_DELETE.COUNT_MEMBERSHIPS, [tenantId]
    );
    if (memberships === 0) {
      throw new HttpError(MESSAGES.ERROR.TENANT_NOT_FOUND, 404);
    }

    const [[{ total: superAdmins }]] = await conn.execute(
      QUERIES.TENANT_DELETE.COUNT_SUPER_ADMINS, [tenantId]
    );
    if (superAdmins > 0) {
      throw new HttpError(MESSAGES.ERROR.TENANT_DELETE_SUPER_ADMIN, 403);
    }

    // Read the membership picture while user_tenants still exists.
    const [members] = await conn.execute(
      QUERIES.TENANT_DELETE.SELECT_MEMBERS, [tenantId]
    );
    const [soleMembers] = await conn.execute(
      QUERIES.TENANT_DELETE.SELECT_SOLE_MEMBERS, [tenantId]
    );
    // Who ran it. Captured here because the sweep below removes the only rows
    // that could answer it, and an audit trail that cannot say whose tenancy
    // was erased is not much of a trail.
    const [admins] = await conn.execute(
      QUERIES.TENANT_DELETE.SELECT_ADMINS, [tenantId]
    );

    for (const sql of QUERIES.TENANT_DELETE.SWEEP) {
      await conn.execute(sql, [tenantId]);
    }

    // Only the people this tenancy was the last of. Anybody still holding a
    // membership elsewhere keeps their onboarding record exactly as it was.
    for (const { user_email: email } of soleMembers) {
      await conn.execute(QUERIES.TENANT_DELETE.DELETE_ONBOARDING_BY_EMAIL, [email]);
    }

    const result = {
      tenantId,
      membersRemoved: members.length,
      accountsReset: soleMembers.length,
      disassociated: members.length - soleMembers.length,
      adminEmails: admins.map((a) => a.user_email),
    };
    logger.warn('Tenancy deleted', result);
    return result;
  });
};

// ─── ROLE MANAGEMENT ──────────────────────────────────────────────────────────

const listRoles = (tenantId) =>
  withConnection(async (conn) => {
    const [rows] = await conn.execute(QUERIES.ROLES.SELECT_WITH_COUNTS, [tenantId]);
    return rows;
  });

const createRole = (tenantId, name, description) =>
  withConnection(async (conn) => {
    const id = uuidv4();
    await conn.execute(QUERIES.ROLES.INSERT, [id, tenantId, name, description || null]);
    const [rows] = await conn.execute(QUERIES.ROLES.SELECT_BY_ID, [id, tenantId]);
    return rows[0];
  });

const updateRole = (roleId, tenantId, updates) =>
  withConnection(async (conn) => {
    const [existing] = await conn.execute(QUERIES.ROLES.SELECT_BY_ID, [roleId, tenantId]);
    if (existing.length === 0) throw new HttpError('Role not found.', 404);
    if (existing[0].is_system_role) {
      throw new HttpError(MESSAGES.ERROR.SYSTEM_ROLE_PROTECTED, 403);
    }
    const { name, description, isActive } = updates;
    await conn.execute(QUERIES.ROLES.UPDATE, [
      name        ?? existing[0].name,
      description ?? existing[0].description,
      isActive !== undefined ? (isActive ? 1 : 0) : existing[0].is_active,
      roleId,
      tenantId,
    ]);
    const [updated] = await conn.execute(QUERIES.ROLES.SELECT_BY_ID, [roleId, tenantId]);
    return updated[0];
  });

const deleteRole = (roleId, tenantId) =>
  withConnection(async (conn) => {
    const [existing] = await conn.execute(QUERIES.ROLES.SELECT_BY_ID, [roleId, tenantId]);
    if (existing.length === 0) throw new HttpError('Role not found.', 404);
    if (existing[0].is_system_role) {
      throw new HttpError(MESSAGES.ERROR.SYSTEM_ROLE_PROTECTED, 403);
    }
    await conn.execute(QUERIES.ROLES.DELETE, [roleId, tenantId]);
  });

const getRolePermissions = (roleId) =>
  withConnection(async (conn) => {
    const [rows] = await conn.execute(QUERIES.ROLE_PERMISSIONS.SELECT_BY_ROLE, [roleId]);
    return rows;
  });

// Replaces all permissions for a role atomically.
// All users holding this role get the updated scopes on their next login.
const setRolePermissions = (roleId, tenantId, featureIds) =>
  withTransaction(async (conn) => {
    const [check] = await conn.execute(QUERIES.ROLES.SELECT_BY_ID, [roleId, tenantId]);
    if (check.length === 0) throw new HttpError('Role not found.', 404);
    await conn.execute(QUERIES.ROLE_PERMISSIONS.DELETE_ALL_FOR_ROLE, [roleId]);
    for (const featureId of featureIds) {
      await conn.execute(QUERIES.ROLE_PERMISSIONS.INSERT, [uuidv4(), roleId, featureId]);
    }
  });

// ─── USER ROLES READ ─────────────────────────────────────────────────────────

const getUserRoles = (email, tenantId) =>
  withConnection(async (conn) => {
    const [check] = await conn.execute(
      'SELECT id FROM user_tenants WHERE user_email = ? AND tenant_id = ?',
      [email, tenantId]
    );
    if (check.length === 0) throw new HttpError('User not found in tenant.', 404);
    const [rows] = await conn.execute(QUERIES.USER_ROLES.SELECT_BY_USER_TENANT, [email, tenantId]);
    return rows;
  });

// ─── FEATURE MANAGEMENT ───────────────────────────────────────────────────────

const listFeatures = () =>
  withConnection(async (conn) => {
    const [rows] = await conn.execute(QUERIES.FEATURES.SELECT_ALL);
    return rows;
  });

const createFeature = ({ featureShortName, scope, displayName, category, description }) =>
  withConnection(async (conn) => {
    const id = uuidv4();
    await conn.execute(QUERIES.FEATURES.INSERT, [
      id,
      `${featureShortName} ${scope}`,
      featureShortName,
      scope,
      displayName,
      category || null,
      description || null,
    ]);
    const [rows] = await conn.execute(QUERIES.FEATURES.SELECT_BY_ID, [id]);
    return rows[0];
  });

const updateFeature = (featureId, updates) =>
  withConnection(async (conn) => {
    const [existing] = await conn.execute(QUERIES.FEATURES.SELECT_BY_ID, [featureId]);
    if (existing.length === 0) throw new HttpError('Feature not found.', 404);
    const f = existing[0];
    await conn.execute(QUERIES.FEATURES.UPDATE, [
      updates.displayName ?? f.display_name,
      updates.scope       ?? f.scope,
      updates.category    ?? f.category,
      updates.description ?? f.description,
      updates.isActive !== undefined ? (updates.isActive ? 1 : 0) : f.is_active,
      featureId,
    ]);
    const [updated] = await conn.execute(QUERIES.FEATURES.SELECT_BY_ID, [featureId]);
    return updated[0];
  });

const deleteFeature = (featureId) =>
  withConnection(async (conn) => {
    const [[{ cnt }]] = await conn.execute(QUERIES.FEATURES.CHECK_IN_USE, [featureId]);
    if (cnt > 0) throw new HttpError(MESSAGES.ERROR.FEATURE_IN_USE, 409);
    await conn.execute('DELETE FROM features WHERE feature_id = ?', [featureId]);
  });

module.exports = {
  listOnboardingRequests,
  approveRequest,
  provisionApprovedUser,
  provisionTenantIam,
  autoApproveOnboarding,
  rejectRequest,
  reopenRequest,
  listUsers,
  listAllUsers,
  listTenants,
  listUsersInTenant,
  getUserDetail,
  getUserRoles,
  updateUserRoles,
  updateUserStatus,
  updateUserStatusCrossTenant,
  removeUser,
  deleteTenant,
  setTenantAdmin,
  updateUserProfile,
  listRoles,
  createRole,
  updateRole,
  deleteRole,
  getRolePermissions,
  setRolePermissions,
  listFeatures,
  createFeature,
  updateFeature,
  deleteFeature,
};
