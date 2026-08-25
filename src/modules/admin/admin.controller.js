// src/modules/admin/admin.controller.js

const { asyncHandler, extractUserContext } = require('../../utils/controllerHelper');
const {
  successResponse,
  createdResponse,
  noContentResponse,
  paginatedResponse,
} = require('../../utils/responseHelper');
const { validateBody, validateQuery, validateUuidParam, validateIdParam } = require('../../middleware/validation');
const service = require('./admin.service');
const schemas = require('./admin.schemas');
const MESSAGES = require('../../config/messages');
const { captureAudit } = require('../../utils/logger');
const { HttpError } = require('../../middleware/errorHandler');
const { STATUSES, AUDIT_CATEGORIES, SCOPES } = require('../../config/constants');

// ─── ONBOARDING ───────────────────────────────────────────────────────────────

const listRequests = [
  validateQuery(schemas.listRequestsSchema),
  asyncHandler(async (req, res) => {
    const { status, page, limit } = req.validatedQuery;
    const result = await service.listOnboardingRequests(status, page, limit);
    paginatedResponse(res, result.data, result.pagination, 'Onboarding requests retrieved');
  }),
];

/**
 * The tenancy an approval may target.
 *
 * A SUPER admin legitimately places users into any tenancy — that is the job.
 * Anyone else may only act on their own, so a body value that disagrees with
 * their token is refused rather than silently honoured. Before this, the body
 * was trusted outright; it was safe only because no tenant admin could reach
 * the route at all.
 *
 * @param {Object} req
 * @param {string} requestedTenantId - The tenant named in the request body.
 * @returns {string} The tenant id to provision into.
 */
const resolveTargetTenant = (req, requestedTenantId) => {
  const { tid: callerTenantId, scopes = [] } = req.user;
  if (scopes.includes(SCOPES.TENANT_SUPER_ADMIN)) return requestedTenantId;
  if (requestedTenantId && requestedTenantId !== callerTenantId) {
    throw new HttpError(MESSAGES.ERROR.CROSS_TENANT_FORBIDDEN, 403);
  }
  return callerTenantId;
};

const approveRequest = [
  validateUuidParam('requestId'),
  validateBody(schemas.approveRequestSchema),
  asyncHandler(async (req, res) => {
    const { userEmail: email, tenantId } = extractUserContext(req);
    const { tenantId: requestedTenantId, roleIds } = req.validatedBody;
    const targetTenantId = resolveTargetTenant(req, requestedTenantId);
    const result = await service.approveRequest(req.params.requestId, targetTenantId, roleIds, email);

    await captureAudit(req, tenantId, email,
      'ONBOARDING_APPROVED', STATUSES.SUCCESS,
      AUDIT_CATEGORIES.ONBOARDING, 'INFO', req.params.requestId);

    successResponse(res, MESSAGES.SUCCESS.ONBOARDING_APPROVED, result);
  }),
];

const rejectRequest = [
  validateUuidParam('requestId'),
  validateBody(schemas.rejectRequestSchema),
  asyncHandler(async (req, res) => {
    const { userEmail: email, tenantId } = extractUserContext(req);
    const { reason } = req.validatedBody;
    await service.rejectRequest(req.params.requestId, reason, email);

    await captureAudit(req, tenantId, email,
      'ONBOARDING_REJECTED', STATUSES.SUCCESS,
      AUDIT_CATEGORIES.ONBOARDING, 'WARN', req.params.requestId);

    successResponse(res, MESSAGES.SUCCESS.ONBOARDING_REJECTED);
  }),
];

// Part 2I aliases
const listOnboarding = [
  validateQuery(schemas.listRequestsSchema),
  asyncHandler(async (req, res) => {
    const { status, page, limit } = req.validatedQuery;
    const result = await service.listOnboardingRequests(status, page, limit);
    paginatedResponse(res, result.data, result.pagination, 'Onboarding requests retrieved');
  }),
];

const approveOnboarding = [
  validateUuidParam('id'),
  validateBody(schemas.approveOnboardingSchema),
  asyncHandler(async (req, res) => {
    const { userEmail: email, tenantId } = extractUserContext(req);
    const { tenantId: requestedTenantId, roleIds } = req.validatedBody;
    const targetTenantId = resolveTargetTenant(req, requestedTenantId);
    const result = await service.approveRequest(req.params.id, targetTenantId, roleIds, email);

    await captureAudit(req, tenantId, email,
      'ONBOARDING_APPROVED', STATUSES.SUCCESS,
      AUDIT_CATEGORIES.ONBOARDING, 'INFO', req.params.id);

    successResponse(res, MESSAGES.SUCCESS.ONBOARDING_APPROVED, result);
  }),
];

const rejectOnboarding = [
  validateUuidParam('id'),
  validateBody(schemas.rejectOnboardingSchema),
  asyncHandler(async (req, res) => {
    const { userEmail: email, tenantId } = extractUserContext(req);
    const { rejectionReason } = req.validatedBody;
    await service.rejectRequest(req.params.id, rejectionReason, email);

    await captureAudit(req, tenantId, email,
      'ONBOARDING_REJECTED', STATUSES.SUCCESS,
      AUDIT_CATEGORIES.ONBOARDING, 'WARN', req.params.id);

    successResponse(res, MESSAGES.SUCCESS.ONBOARDING_REJECTED);
  }),
];

const reopenOnboarding = [
  validateUuidParam('id'),
  asyncHandler(async (req, res) => {
    const { userEmail: email, tenantId } = extractUserContext(req);
    await service.reopenRequest(req.params.id, email);

    await captureAudit(req, tenantId, email,
      'ONBOARDING_REOPENED', STATUSES.UPDATED,
      AUDIT_CATEGORIES.ONBOARDING, 'INFO', req.params.id);

    successResponse(res, MESSAGES.SUCCESS.ONBOARDING_REOPENED);
  }),
];

// ─── USER MANAGEMENT ──────────────────────────────────────────────────────────

const listUsers = [
  validateQuery(schemas.listUsersSchema),
  asyncHandler(async (req, res) => {
    const { tenantId } = extractUserContext(req);
    const { page, limit } = req.validatedQuery;
    const result = await service.listUsers(tenantId, page, limit);
    paginatedResponse(res, result.data, result.pagination, 'Users retrieved');
  }),
];

// Super-admin only: list users across every tenant (route-gated by scope).
const listAllUsers = [
  validateQuery(schemas.listUsersSchema),
  asyncHandler(async (req, res) => {
    const { page, limit } = req.validatedQuery;
    const result = await service.listAllUsers(page, limit);
    paginatedResponse(res, result.data, result.pagination, 'All users retrieved');
  }),
];

// Every tenancy, with its totals. Super admin only — see the route guard.
const listTenants = [
  validateQuery(schemas.listUsersSchema),
  asyncHandler(async (req, res) => {
    const { page, limit } = req.validatedQuery;
    const result = await service.listTenants(page, limit);
    paginatedResponse(res, result.data, result.pagination, 'Tenancies retrieved');
  }),
];

// The people inside one tenancy, for the directory above. The tenancy comes
// from the PATH here rather than from the token, which is exactly why this sits
// behind the super-admin guard.
const listUsersInTenant = [
  asyncHandler(async (req, res) => {
    const users = await service.listUsersInTenant(req.params.tenantId);
    successResponse(res, 'Tenancy users retrieved', users);
  }),
];

const getUserDetail = [
  asyncHandler(async (req, res) => {
    const { tenantId } = extractUserContext(req);
    const user = await service.getUserDetail(req.params.email, tenantId);
    successResponse(res, 'User detail retrieved', user);
  }),
];

const getUserRoles = [
  asyncHandler(async (req, res) => {
    const { tenantId } = extractUserContext(req);
    const roles = await service.getUserRoles(req.params.email, tenantId);
    successResponse(res, 'User roles retrieved', roles);
  }),
];

const updateUserRoles = [
  validateBody(schemas.updateUserRolesSchema),
  asyncHandler(async (req, res) => {
    const { userEmail: adminEmail, tenantId } = extractUserContext(req);
    await service.updateUserRoles(req.params.email, tenantId, req.body.roleIds, adminEmail);

    await captureAudit(req, tenantId, adminEmail,
      'UPDATE_USER_ROLES', STATUSES.UPDATED,
      AUDIT_CATEGORIES.USER_MGMT, 'INFO', req.params.email);

    successResponse(res, MESSAGES.SUCCESS.USER_ROLES_UPDATED);
  }),
];

const updateUserStatus = [
  validateBody(schemas.updateUserStatusSchema),
  asyncHandler(async (req, res) => {
    const { userEmail: adminEmail, tenantId } = extractUserContext(req);
    await service.updateUserStatus(req.params.email, tenantId, req.body.status, adminEmail);

    const isSuspend = req.body.status === 'SUSPENDED';
    await captureAudit(req, tenantId, adminEmail,
      isSuspend ? 'SUSPEND_USER' : 'ACTIVATE_USER',
      isSuspend ? STATUSES.SUSPENDED : STATUSES.ACTIVATED,
      AUDIT_CATEGORIES.USER_MGMT,
      isSuspend ? 'WARN' : 'INFO',
      req.params.email);

    successResponse(res, MESSAGES.SUCCESS.USER_STATUS_UPDATED);
  }),
];

// Super-admin only: suspend/activate a user in any tenant (target in the body).
const updateUserStatusCrossTenant = [
  validateBody(schemas.updateUserStatusCrossTenantSchema),
  asyncHandler(async (req, res) => {
    const { userEmail: adminEmail } = extractUserContext(req);
    const { email, tenantId, status } = req.body;
    await service.updateUserStatusCrossTenant(email, tenantId, status, adminEmail);

    const isSuspend = status === 'SUSPENDED';
    await captureAudit(req, tenantId, adminEmail,
      isSuspend ? 'SUSPEND_USER' : 'ACTIVATE_USER',
      isSuspend ? STATUSES.SUSPENDED : STATUSES.ACTIVATED,
      AUDIT_CATEGORIES.USER_MGMT,
      isSuspend ? 'WARN' : 'INFO',
      email);

    successResponse(res, MESSAGES.SUCCESS.USER_STATUS_UPDATED);
  }),
];

// The staff details on a membership. Separate from roles and from the admin
// flag because what somebody is CALLED, what they may DO and whether they may
// ADMINISTER are three different decisions carrying three different risks.
const updateUserProfile = [
  validateBody(schemas.updateUserProfileSchema),
  asyncHandler(async (req, res) => {
    const { userEmail: adminEmail, tenantId } = extractUserContext(req);
    await service.updateUserProfile(req.params.email, tenantId, req.validatedBody, adminEmail);

    await captureAudit(req, tenantId, adminEmail,
      'USER_PROFILE_UPDATED', STATUSES.SUCCESS,
      AUDIT_CATEGORIES.USER_MGMT, 'INFO', req.params.email);

    successResponse(res, 'Staff details updated');
  }),
];

// Grant or withdraw tenant-administrator access. Separate from role assignment
// on purpose: TENANT:ADMIN comes from the membership flag, not from any role,
// so conflating the two is exactly what made "assign the SUPER_ADMIN role" look
// like it should work and then not.
const setTenantAdmin = [
  validateBody(schemas.setTenantAdminSchema),
  asyncHandler(async (req, res) => {
    const { userEmail: adminEmail, tenantId } = extractUserContext(req);
    const { isAdmin } = req.validatedBody;
    await service.setTenantAdmin(req.params.email, tenantId, isAdmin, adminEmail);

    await captureAudit(req, tenantId, adminEmail,
      isAdmin ? 'USER_GRANTED_ADMIN' : 'USER_REVOKED_ADMIN', STATUSES.SUCCESS,
      AUDIT_CATEGORIES.USER_MGMT, 'WARN', req.params.email);

    successResponse(res, isAdmin
      ? 'Tenant administrator access granted'
      : 'Tenant administrator access withdrawn');
  }),
];

const removeUser = [
  asyncHandler(async (req, res) => {
    const { userEmail: adminEmail, tenantId } = extractUserContext(req);
    await service.removeUser(req.params.email, tenantId, adminEmail);

    await captureAudit(req, tenantId, adminEmail,
      'REMOVE_USER', STATUSES.DELETED,
      AUDIT_CATEGORIES.USER_MGMT, 'WARN', req.params.email);

    successResponse(res, MESSAGES.SUCCESS.USER_REMOVED);
  }),
];

// ─── ROLE MANAGEMENT ──────────────────────────────────────────────────────────

const listRoles = [
  asyncHandler(async (req, res) => {
    const { tenantId } = extractUserContext(req);
    const roles = await service.listRoles(tenantId);
    successResponse(res, 'Roles retrieved', roles);
  }),
];

const createRole = [
  validateBody(schemas.createRoleSchema),
  asyncHandler(async (req, res) => {
    const { userEmail, tenantId } = extractUserContext(req);
    const { name, description } = req.body;
    const role = await service.createRole(tenantId, name, description);

    await captureAudit(req, tenantId, userEmail,
      'CREATE_ROLE', STATUSES.CREATED,
      AUDIT_CATEGORIES.ROLE_MGMT, 'INFO', role.id);

    createdResponse(res, MESSAGES.SUCCESS.ROLE_CREATED, role);
  }),
];

const updateRole = [
  validateIdParam('roleId'),
  validateBody(schemas.updateRoleSchema),
  asyncHandler(async (req, res) => {
    const { userEmail, tenantId } = extractUserContext(req);
    const role = await service.updateRole(req.params.roleId, tenantId, req.body);

    await captureAudit(req, tenantId, userEmail,
      'UPDATE_ROLE', STATUSES.UPDATED,
      AUDIT_CATEGORIES.ROLE_MGMT, 'INFO', req.params.roleId);

    successResponse(res, MESSAGES.SUCCESS.ROLE_UPDATED, role);
  }),
];

const deleteRole = [
  validateIdParam('roleId'),
  asyncHandler(async (req, res) => {
    const { userEmail, tenantId } = extractUserContext(req);
    await service.deleteRole(req.params.roleId, tenantId);

    await captureAudit(req, tenantId, userEmail,
      'DELETE_ROLE', STATUSES.DELETED,
      AUDIT_CATEGORIES.ROLE_MGMT, 'WARN', req.params.roleId);

    successResponse(res, MESSAGES.SUCCESS.ROLE_DELETED);
  }),
];

const getRolePermissions = [
  validateIdParam('roleId'),
  asyncHandler(async (req, res) => {
    const permissions = await service.getRolePermissions(req.params.roleId);
    successResponse(res, 'Role permissions retrieved', permissions);
  }),
];

const setRolePermissions = [
  validateIdParam('roleId'),
  validateBody(schemas.updateRolePermissionsSchema),
  asyncHandler(async (req, res) => {
    const { userEmail, tenantId } = extractUserContext(req);
    await service.setRolePermissions(req.params.roleId, tenantId, req.body.featureIds);

    await captureAudit(req, tenantId, userEmail,
      'SET_ROLE_PERMISSIONS', STATUSES.UPDATED,
      AUDIT_CATEGORIES.ROLE_MGMT, 'INFO', req.params.roleId);

    successResponse(res, MESSAGES.SUCCESS.ROLE_UPDATED);
  }),
];

// ─── FEATURE MANAGEMENT ───────────────────────────────────────────────────────

const listFeatures = [
  asyncHandler(async (req, res) => {
    const features = await service.listFeatures();
    successResponse(res, 'Features retrieved', features);
  }),
];

const createFeature = [
  validateBody(schemas.createFeatureSchema),
  asyncHandler(async (req, res) => {
    const { userEmail, tenantId } = extractUserContext(req);
    const feature = await service.createFeature(req.body);

    await captureAudit(req, tenantId, userEmail,
      'CREATE_FEATURE', STATUSES.CREATED,
      AUDIT_CATEGORIES.FEATURE_MGMT, 'INFO', feature.feature_id ?? feature.id);

    createdResponse(res, MESSAGES.SUCCESS.FEATURE_CREATED, feature);
  }),
];

const updateFeature = [
  validateIdParam('featureId'),
  validateBody(schemas.updateFeatureSchema),
  asyncHandler(async (req, res) => {
    const { userEmail, tenantId } = extractUserContext(req);
    const feature = await service.updateFeature(req.params.featureId, req.body);

    await captureAudit(req, tenantId, userEmail,
      'UPDATE_FEATURE', STATUSES.UPDATED,
      AUDIT_CATEGORIES.FEATURE_MGMT, 'INFO', req.params.featureId);

    successResponse(res, MESSAGES.SUCCESS.FEATURE_UPDATED, feature);
  }),
];

const deleteFeature = [
  validateIdParam('featureId'),
  asyncHandler(async (req, res) => {
    const { userEmail, tenantId } = extractUserContext(req);
    await service.deleteFeature(req.params.featureId);

    await captureAudit(req, tenantId, userEmail,
      'DELETE_FEATURE', STATUSES.DELETED,
      AUDIT_CATEGORIES.FEATURE_MGMT, 'WARN', req.params.featureId);

    noContentResponse(res);
  }),
];

module.exports = {
  listRequests,
  approveRequest,
  rejectRequest,
  listOnboarding,
  approveOnboarding,
  rejectOnboarding,
  reopenOnboarding,
  listUsers,
  listAllUsers,
  listTenants,
  listUsersInTenant,
  getUserDetail,
  getUserRoles,
  updateUserRoles,
  updateUserStatus,
  updateUserStatusCrossTenant,
  setTenantAdmin,
  updateUserProfile,
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
