// src/modules/admin/admin.routes.js
// Administration, split by the authority each route actually needs.
//
// Every route here used to be gated on 'admin:access' alone — a scope that is
// never granted to anybody, so the whole module was reachable only through the
// super-admin bypass inside checkScope. A tenant admin could not manage their
// own tenancy at all.
//
// The fix is not one flat scope. These routes fall into two genuinely different
// authorities:
//
//   tenantAdmin  — acts on ONE tenancy, and every service below filters by
//                  req.user.tid. Safe for a tenant admin.
//   superAdmin   — acts across tenancies, or on platform-wide data that is not
//                  tenant-scoped at all (the onboarding queue has no tenant
//                  column until a request is approved; the feature catalogue is
//                  global). Not safe to widen.
//
// 'admin:access' is gone. No code ever issued it and no role could grant it, so
// it only ever let in a hand-made token.
//
// Every route that changes somebody's access writes ONE audit row: the
// controller's, which names who or what was changed and how (before → after).
// The route-level row below defers to it on success (deferToCapture) and is
// written only when the request fails before the controller gets that far.

const express = require('express');
const router = express.Router();
const { authenticateToken, checkScope } = require('../../middleware/authMiddleware');
const { auditLog } = require('../../middleware/auditLogger');
const { HttpError } = require('../../middleware/errorHandler');
const MESSAGES = require('../../config/messages');
const { SCOPES, AUDIT_CATEGORIES, AUDIT_ACTIONS } = require('../../config/constants');
const c = require('./admin.controller');

// Tenant-scoped administration. Both admin kinds pass; the service layer is
// what confines the work to req.user.tid.
const tenantAdmin = [
  authenticateToken,
  checkScope(SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN),
];
// Any member of a tenancy, whatever they hold — a member with no roles at all
// still needs to know whom to ask for access.
const tenantMember = [
  authenticateToken,
  (req, res, next) => (req.user && req.user.tid
    ? next()
    : next(new HttpError(MESSAGES.ERROR.TENANT_ACCESS_DENIED, MESSAGES.HTTP_STATUS.FORBIDDEN))),
];
const once = { deferToCapture: true };
// Cross-tenant views and platform-wide data. Super admins only — note that
// checkScope admits them to everything above as well, via its bypass.
const superAdminOnly = [authenticateToken, checkScope(SCOPES.TENANT_SUPER_ADMIN)];

// ── Onboarding requests ───────────────────────────────────────────────────────
// SUPER ADMIN ONLY, deliberately. A request carries no tenant_id until it is
// approved, so this queue cannot be filtered per tenant — showing it to a
// tenant admin would expose every pending signup on the platform. Tenant admins
// add people to their own tenancy through invitations instead.
router.get('/onboarding-requests',
  ...superAdminOnly, auditLog(AUDIT_CATEGORIES.ONBOARDING, 'DEBUG', AUDIT_ACTIONS.VIEW_ONBOARDING), ...c.listRequests);

router.post('/onboarding-requests/:requestId/approve',
  ...superAdminOnly, auditLog(AUDIT_CATEGORIES.ONBOARDING, 'INFO', AUDIT_ACTIONS.APPROVE_ONBOARDING), ...c.approveRequest);

router.post('/onboarding-requests/:requestId/reject',
  ...superAdminOnly, auditLog(AUDIT_CATEGORIES.ONBOARDING, 'WARN', AUDIT_ACTIONS.REJECT_ONBOARDING), ...c.rejectRequest);

// ── Onboarding (Part 2I — shorter paths, PUT, frontend-friendly) ──────────────
router.get('/onboarding',
  ...superAdminOnly, auditLog(AUDIT_CATEGORIES.ONBOARDING, 'DEBUG', AUDIT_ACTIONS.VIEW_ONBOARDING), ...c.listOnboarding);

router.put('/onboarding/:id/approve',
  ...superAdminOnly, auditLog(AUDIT_CATEGORIES.ONBOARDING, 'INFO', AUDIT_ACTIONS.APPROVE_ONBOARDING), ...c.approveOnboarding);

router.put('/onboarding/:id/reject',
  ...superAdminOnly, auditLog(AUDIT_CATEGORIES.ONBOARDING, 'WARN', AUDIT_ACTIONS.REJECT_ONBOARDING), ...c.rejectOnboarding);

router.put('/onboarding/:id/reopen',
  ...superAdminOnly, auditLog(AUDIT_CATEGORIES.ONBOARDING, 'INFO', AUDIT_ACTIONS.REOPEN_ONBOARDING), ...c.reopenOnboarding);

// ── Cross-tenant directory ───────────────────────────────────────────────────
// SUPER ADMIN ONLY. Both take a tenancy that is NOT the caller's own — the
// first lists every tenancy on the platform, the second reads the staff list of
// one of them from the path rather than from the token. A tenant admin must
// never reach either: their own people are at GET /users, scoped to req.user.tid.
//
// Declared before '/users' so neither path is captured by a :param route below.
router.get('/tenants',
  ...superAdminOnly, auditLog(AUDIT_CATEGORIES.USER_MGMT, 'DEBUG', AUDIT_ACTIONS.VIEW_USERS), ...c.listTenants);

router.get('/tenants/:tenantId/users',
  ...superAdminOnly, auditLog(AUDIT_CATEGORIES.USER_MGMT, 'DEBUG', AUDIT_ACTIONS.VIEW_USERS), ...c.listUsersInTenant);

// Erase a tenancy and everything under it. SUPER ADMIN ONLY, and it stays that
// way permanently: a tenant admin destroying their own tenancy is not a feature,
// and the target is read from the path rather than the token precisely because
// this acts on somebody else's. The service refuses the caller's own tenancy,
// a tenancy holding a super admin, and an id that is not in the directory.
router.delete('/tenants/:tenantId',
  ...superAdminOnly, auditLog(AUDIT_CATEGORIES.USER_MGMT, 'WARN', AUDIT_ACTIONS.DELETE_TENANT), ...c.deleteTenant);

// ── User management ───────────────────────────────────────────────────────────
router.get('/users',
  ...tenantAdmin, auditLog(AUDIT_CATEGORIES.USER_MGMT, 'DEBUG', AUDIT_ACTIONS.VIEW_USERS), ...c.listUsers);

// Super-admin-only cross-tenant listing. MUST precede '/users/:phone' so the
// literal 'all' segment isn't captured as a :phone param.
router.get('/users/all',
  ...superAdminOnly, auditLog(AUDIT_CATEGORIES.USER_MGMT, 'DEBUG', AUDIT_ACTIONS.VIEW_USERS), ...c.listAllUsers);

// Super-admin-only cross-tenant suspend/activate (target user + tenant in body).
// MUST precede '/users/:phone/status' so 'all' isn't captured as a :phone param.
router.put('/users/all/status',
  ...superAdminOnly, auditLog(AUDIT_CATEGORIES.USER_MGMT, 'WARN', AUDIT_ACTIONS.UPDATE_USER_STATUS, once), ...c.updateUserStatusCrossTenant);

router.get('/users/:phone/roles',
  ...tenantAdmin, auditLog(AUDIT_CATEGORIES.USER_MGMT, 'DEBUG', AUDIT_ACTIONS.VIEW_USER_ROLES), ...c.getUserRoles);

router.get('/users/:phone',
  ...tenantAdmin, auditLog(AUDIT_CATEGORIES.USER_MGMT, 'DEBUG', AUDIT_ACTIONS.VIEW_USER_DETAIL), ...c.getUserDetail);

router.put('/users/:phone/roles',
  ...tenantAdmin, auditLog(AUDIT_CATEGORIES.USER_MGMT, 'INFO', AUDIT_ACTIONS.UPDATE_USER_ROLES, once), ...c.updateUserRoles);

router.put('/users/:phone/status',
  ...tenantAdmin, auditLog(AUDIT_CATEGORIES.USER_MGMT, 'WARN', AUDIT_ACTIONS.UPDATE_USER_STATUS, once), ...c.updateUserStatus);

// The staff details on a membership — name and home branch. A staff member IS a
// membership now; there is no separate roster. Logged under its own label: it
// used to share "Updated user roles" with the route above.
router.put('/users/:phone/profile',
  ...tenantAdmin, auditLog(AUDIT_CATEGORIES.USER_MGMT, 'INFO', AUDIT_ACTIONS.UPDATE_USER_PROFILE, once), ...c.updateUserProfile);

// Grant / withdraw tenant-administrator access. Distinct from role assignment
// because TENANT:ADMIN is derived from the membership flag, never from a role.
// Its own label too — it used to be logged as "Updated user status".
router.put('/users/:phone/admin',
  ...tenantAdmin, auditLog(AUDIT_CATEGORIES.USER_MGMT, 'WARN', AUDIT_ACTIONS.UPDATE_USER_ADMIN, once), ...c.setTenantAdmin);

router.delete('/users/:phone',
  ...tenantAdmin, auditLog(AUDIT_CATEGORIES.USER_MGMT, 'WARN', AUDIT_ACTIONS.REMOVE_USER, once), ...c.removeUser);

// ── Role management ───────────────────────────────────────────────────────────
router.get('/roles',
  ...tenantAdmin, auditLog(AUDIT_CATEGORIES.ROLE_MGMT, 'DEBUG', AUDIT_ACTIONS.VIEW_ROLES), ...c.listRoles);

router.post('/roles',
  ...tenantAdmin, auditLog(AUDIT_CATEGORIES.ROLE_MGMT, 'INFO', AUDIT_ACTIONS.CREATE_ROLE, once), ...c.createRole);

router.put('/roles/:roleId',
  ...tenantAdmin, auditLog(AUDIT_CATEGORIES.ROLE_MGMT, 'INFO', AUDIT_ACTIONS.UPDATE_ROLE, once), ...c.updateRole);

router.delete('/roles/:roleId',
  ...tenantAdmin, auditLog(AUDIT_CATEGORIES.ROLE_MGMT, 'WARN', AUDIT_ACTIONS.DELETE_ROLE, once), ...c.deleteRole);

// Every grant of every role here in one read: the permission matrix, role
// comparison and access preview are all built from it.
router.get('/roles/permissions',
  ...tenantAdmin, auditLog(AUDIT_CATEGORIES.ROLE_MGMT, 'DEBUG', AUDIT_ACTIONS.VIEW_ROLE_PERMISSIONS), ...c.listRolePermissionMatrix);

router.get('/roles/:roleId/permissions',
  ...tenantAdmin, auditLog(AUDIT_CATEGORIES.ROLE_MGMT, 'DEBUG', AUDIT_ACTIONS.VIEW_ROLE_PERMISSIONS), ...c.getRolePermissions);

router.put('/roles/:roleId/permissions',
  ...tenantAdmin, auditLog(AUDIT_CATEGORIES.ROLE_MGMT, 'INFO', AUDIT_ACTIONS.UPDATE_ROLE_PERMISSIONS, once), ...c.setRolePermissions);

// ── Who can grant access ──────────────────────────────────────────────────────
// Readable by every member: the Access Denied page names the administrators a
// refused person can ask. Names and numbers only, of this tenancy only.
router.get('/administrators', ...tenantMember, ...c.listAdministrators);

// ── Feature management ────────────────────────────────────────────────────────
// The catalogue is GLOBAL (features has no tenant_id). Reading it is required to
// render a role-permission editor, so a tenant admin may list. Creating or
// deleting one changes what EVERY tenant can be granted, so writes stay with
// the super admin.
router.get('/features',
  ...tenantAdmin, auditLog(AUDIT_CATEGORIES.FEATURE_MGMT, 'DEBUG', AUDIT_ACTIONS.VIEW_FEATURES), ...c.listFeatures);

router.post('/features',
  ...superAdminOnly, auditLog(AUDIT_CATEGORIES.FEATURE_MGMT, 'INFO', AUDIT_ACTIONS.CREATE_FEATURE), ...c.createFeature);

router.put('/features/:featureId',
  ...superAdminOnly, auditLog(AUDIT_CATEGORIES.FEATURE_MGMT, 'INFO', AUDIT_ACTIONS.UPDATE_FEATURE), ...c.updateFeature);

router.delete('/features/:featureId',
  ...superAdminOnly, auditLog(AUDIT_CATEGORIES.FEATURE_MGMT, 'WARN', AUDIT_ACTIONS.DELETE_FEATURE), ...c.deleteFeature);

module.exports = router;
