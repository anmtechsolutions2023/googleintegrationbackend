// src/modules/admin/admin.controller.js

const { asyncHandler, extractUserContext } = require('../../utils/controllerHelper');
const {
  successResponse,
  createdResponse,
  noContentResponse,
  paginatedResponse,
} = require('../../utils/responseHelper');
const { validateBody, validateQuery, validateUuidParam } = require('../../middleware/validation');
const service = require('./admin.service');
const schemas = require('./admin.schemas');
const MESSAGES = require('../../config/messages');
const { captureAudit } = require('../../utils/logger');
const { STATUSES, AUDIT_CATEGORIES } = require('../../config/constants');

// ─── ONBOARDING ───────────────────────────────────────────────────────────────

const listRequests = [
  validateQuery(schemas.listRequestsSchema),
  asyncHandler(async (req, res) => {
    const { status, page, limit } = req.validatedQuery;
    const result = await service.listOnboardingRequests(status, page, limit);
    paginatedResponse(res, result.data, result.pagination, 'Onboarding requests retrieved');
  }),
];

const approveRequest = [
  validateUuidParam('requestId'),
  validateBody(schemas.approveRequestSchema),
  asyncHandler(async (req, res) => {
    const { userEmail: email, tenantId } = extractUserContext(req);
    const { tenantId: targetTenantId, roleIds } = req.validatedBody;
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
    const { tenantId: targetTenantId, roleIds } = req.validatedBody;
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
    await service.updateUserStatus(req.params.email, tenantId, req.body.status);

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

const removeUser = [
  asyncHandler(async (req, res) => {
    const { userEmail: adminEmail, tenantId } = extractUserContext(req);
    await service.removeUser(req.params.email, tenantId);

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
  validateUuidParam('roleId'),
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
  validateUuidParam('roleId'),
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
  validateUuidParam('roleId'),
  asyncHandler(async (req, res) => {
    const permissions = await service.getRolePermissions(req.params.roleId);
    successResponse(res, 'Role permissions retrieved', permissions);
  }),
];

const setRolePermissions = [
  validateUuidParam('roleId'),
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
  validateUuidParam('featureId'),
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
  validateUuidParam('featureId'),
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
