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
// 'admin:access' is retained in the tenant-admin guard so any token or client
// already relying on it keeps working.

const express = require('express');
const router = express.Router();
const { authenticateToken, checkScope } = require('../../middleware/authMiddleware');
const { auditLog } = require('../../middleware/auditLogger');
const { SCOPES, AUDIT_CATEGORIES, AUDIT_ACTIONS } = require('../../config/constants');
const c = require('./admin.controller');

// Tenant-scoped administration. Both admin kinds pass; the service layer is
// what confines the work to req.user.tid.
const tenantAdmin = [
  authenticateToken,
  checkScope(SCOPES.ADMIN_ACCESS, SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN),
];
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

// ── User management ───────────────────────────────────────────────────────────
router.get('/users',
  ...tenantAdmin, auditLog(AUDIT_CATEGORIES.USER_MGMT, 'DEBUG', AUDIT_ACTIONS.VIEW_USERS), ...c.listUsers);

// Super-admin-only cross-tenant listing. MUST precede '/users/:email' so the
// literal 'all' segment isn't captured as an :email param.
router.get('/users/all',
  ...superAdminOnly, auditLog(AUDIT_CATEGORIES.USER_MGMT, 'DEBUG', AUDIT_ACTIONS.VIEW_USERS), ...c.listAllUsers);

// Super-admin-only cross-tenant suspend/activate (target user + tenant in body).
// MUST precede '/users/:email/status' so 'all' isn't captured as an :email param.
router.put('/users/all/status',
  ...superAdminOnly, auditLog(AUDIT_CATEGORIES.USER_MGMT, 'WARN', AUDIT_ACTIONS.UPDATE_USER_STATUS), ...c.updateUserStatusCrossTenant);

router.get('/users/:email/roles',
  ...tenantAdmin, auditLog(AUDIT_CATEGORIES.USER_MGMT, 'DEBUG', AUDIT_ACTIONS.VIEW_USER_ROLES), ...c.getUserRoles);

router.get('/users/:email',
  ...tenantAdmin, auditLog(AUDIT_CATEGORIES.USER_MGMT, 'DEBUG', AUDIT_ACTIONS.VIEW_USER_DETAIL), ...c.getUserDetail);

router.put('/users/:email/roles',
  ...tenantAdmin, auditLog(AUDIT_CATEGORIES.USER_MGMT, 'INFO', AUDIT_ACTIONS.UPDATE_USER_ROLES), ...c.updateUserRoles);

router.put('/users/:email/status',
  ...tenantAdmin, auditLog(AUDIT_CATEGORIES.USER_MGMT, 'WARN', AUDIT_ACTIONS.UPDATE_USER_STATUS), ...c.updateUserStatus);

// The staff details on a membership — name, phone, branch. A staff member IS a
// membership now; there is no separate roster.
router.put('/users/:email/profile',
  ...tenantAdmin, auditLog(AUDIT_CATEGORIES.USER_MGMT, 'INFO', AUDIT_ACTIONS.UPDATE_USER_ROLES), ...c.updateUserProfile);

// Grant / withdraw tenant-administrator access. Distinct from role assignment
// because TENANT:ADMIN is derived from the membership flag, never from a role.
router.put('/users/:email/admin',
  ...tenantAdmin, auditLog(AUDIT_CATEGORIES.USER_MGMT, 'WARN', AUDIT_ACTIONS.UPDATE_USER_STATUS), ...c.setTenantAdmin);

router.delete('/users/:email',
  ...tenantAdmin, auditLog(AUDIT_CATEGORIES.USER_MGMT, 'WARN', AUDIT_ACTIONS.REMOVE_USER), ...c.removeUser);

// ── Role management ───────────────────────────────────────────────────────────
router.get('/roles',
  ...tenantAdmin, auditLog(AUDIT_CATEGORIES.ROLE_MGMT, 'DEBUG', AUDIT_ACTIONS.VIEW_ROLES), ...c.listRoles);

router.post('/roles',
  ...tenantAdmin, auditLog(AUDIT_CATEGORIES.ROLE_MGMT, 'INFO', AUDIT_ACTIONS.CREATE_ROLE), ...c.createRole);

router.put('/roles/:roleId',
  ...tenantAdmin, auditLog(AUDIT_CATEGORIES.ROLE_MGMT, 'INFO', AUDIT_ACTIONS.UPDATE_ROLE), ...c.updateRole);

router.delete('/roles/:roleId',
  ...tenantAdmin, auditLog(AUDIT_CATEGORIES.ROLE_MGMT, 'WARN', AUDIT_ACTIONS.DELETE_ROLE), ...c.deleteRole);

router.get('/roles/:roleId/permissions',
  ...tenantAdmin, auditLog(AUDIT_CATEGORIES.ROLE_MGMT, 'DEBUG', AUDIT_ACTIONS.VIEW_ROLE_PERMISSIONS), ...c.getRolePermissions);

router.put('/roles/:roleId/permissions',
  ...tenantAdmin, auditLog(AUDIT_CATEGORIES.ROLE_MGMT, 'INFO', AUDIT_ACTIONS.UPDATE_ROLE_PERMISSIONS), ...c.setRolePermissions);

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
