// src/modules/admin/admin.service.js
// Business logic for onboarding approval, user management, role management,
// and feature/scope management. All write operations use transactions.

const { v4: uuidv4 } = require('uuid');
const { withConnection, withTransaction } = require('../../utils/dbHelper');
const { QUERIES } = require('../../config/constants');
const { HttpError } = require('../../middleware/errorHandler');
const MESSAGES = require('../../config/messages');
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
    const [rows] = await conn.query(
      `${QUERIES.ONBOARDING_REQUESTS.SELECT_ALL}${whereClause} ORDER BY requested_at ASC LIMIT ${limitNum} OFFSET ${offset}`,
      dataParams
    );

    return { data: rows, pagination: getPaginationMetadata(total, pageNum, limitNum) };
  });

const approveRequest = (requestId, tenantId, roleIds, reviewerEmail) =>
  withTransaction(async (conn) => {
    const [reqRows] = await conn.execute(
      'SELECT * FROM onboarding_requests WHERE id = ? AND status = "PENDING"',
      [requestId]
    );
    if (reqRows.length === 0) {
      throw new HttpError('Onboarding request not found or already reviewed.', 404);
    }
    const { email, name } = reqRows[0];

    const [existing] = await conn.execute(
      'SELECT id FROM user_tenants WHERE user_email = ? AND tenant_id = ?',
      [email, tenantId]
    );
    if (existing.length > 0) {
      throw new HttpError(MESSAGES.ERROR.USER_ALREADY_EXISTS, 409);
    }

    await conn.execute(QUERIES.ADMIN_USERS.INSERT_USER_TENANT, [
      uuidv4(),
      email,
      tenantId,
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

    await conn.execute(QUERIES.ONBOARDING_REQUESTS.UPDATE_STATUS, [
      'APPROVED',
      null,
      reviewerEmail,
      tenantId,
      requestId,
    ]);

    return { email, name, tenantId, roleIds };
  });

const rejectRequest = (requestId, reason, reviewerEmail) =>
  withConnection(async (conn) => {
    const [reqRows] = await conn.execute(
      'SELECT * FROM onboarding_requests WHERE id = ? AND status = "PENDING"',
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
    const [check] = await conn.execute(
      'SELECT id FROM user_tenants WHERE user_email = ? AND tenant_id = ?',
      [email, tenantId]
    );
    if (check.length === 0) throw new HttpError('User not found in tenant.', 404);

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

const updateUserStatus = (email, tenantId, status) =>
  withConnection(async (conn) => {
    const isActive = status === 'ACTIVE' ? 1 : 0;
    await conn.execute(QUERIES.ADMIN_USERS.UPDATE_STATUS, [
      isActive,
      status,
      email,
      tenantId,
    ]);
  });

const removeUser = (email, tenantId) =>
  withTransaction(async (conn) => {
    await conn.execute(QUERIES.USER_ROLES.DELETE_ALL_FOR_USER, [email, tenantId]);
    await conn.execute(QUERIES.ADMIN_USERS.DELETE, [email, tenantId]);
  });

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
  rejectRequest,
  listUsers,
  getUserDetail,
  getUserRoles,
  updateUserRoles,
  updateUserStatus,
  removeUser,
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
