// src/modules/admin/admin.routes.js
// All admin routes require a valid JWT with the 'admin:access' scope.

const express = require('express');
const router = express.Router();
const { authenticateToken, checkScope } = require('../../middleware/authMiddleware');
const { auditLog } = require('../../middleware/auditLogger');
const { SCOPES, AUDIT_CATEGORIES, AUDIT_ACTIONS } = require('../../config/constants');
const c = require('./admin.controller');

const adminOnly = [authenticateToken, checkScope(SCOPES.ADMIN_ACCESS)];
// Cross-tenant views are restricted to super admins.
const superAdminOnly = [authenticateToken, checkScope(SCOPES.TENANT_SUPER_ADMIN)];

// ── Onboarding requests ───────────────────────────────────────────────────────
router.get('/onboarding-requests',
  ...adminOnly, auditLog(AUDIT_CATEGORIES.ONBOARDING, 'DEBUG', AUDIT_ACTIONS.VIEW_ONBOARDING), ...c.listRequests);

router.post('/onboarding-requests/:requestId/approve',
  ...adminOnly, auditLog(AUDIT_CATEGORIES.ONBOARDING, 'INFO', AUDIT_ACTIONS.APPROVE_ONBOARDING), ...c.approveRequest);

router.post('/onboarding-requests/:requestId/reject',
  ...adminOnly, auditLog(AUDIT_CATEGORIES.ONBOARDING, 'WARN', AUDIT_ACTIONS.REJECT_ONBOARDING), ...c.rejectRequest);

// ── Onboarding (Part 2I — shorter paths, PUT, frontend-friendly) ──────────────
router.get('/onboarding',
  ...adminOnly, auditLog(AUDIT_CATEGORIES.ONBOARDING, 'DEBUG', AUDIT_ACTIONS.VIEW_ONBOARDING), ...c.listOnboarding);

router.put('/onboarding/:id/approve',
  ...adminOnly, auditLog(AUDIT_CATEGORIES.ONBOARDING, 'INFO', AUDIT_ACTIONS.APPROVE_ONBOARDING), ...c.approveOnboarding);

router.put('/onboarding/:id/reject',
  ...adminOnly, auditLog(AUDIT_CATEGORIES.ONBOARDING, 'WARN', AUDIT_ACTIONS.REJECT_ONBOARDING), ...c.rejectOnboarding);

router.put('/onboarding/:id/reopen',
  ...adminOnly, auditLog(AUDIT_CATEGORIES.ONBOARDING, 'INFO', AUDIT_ACTIONS.REOPEN_ONBOARDING), ...c.reopenOnboarding);

// ── User management ───────────────────────────────────────────────────────────
router.get('/users',
  ...adminOnly, auditLog(AUDIT_CATEGORIES.USER_MGMT, 'DEBUG', AUDIT_ACTIONS.VIEW_USERS), ...c.listUsers);

// Super-admin-only cross-tenant listing. MUST precede '/users/:email' so the
// literal 'all' segment isn't captured as an :email param.
router.get('/users/all',
  ...superAdminOnly, auditLog(AUDIT_CATEGORIES.USER_MGMT, 'DEBUG', AUDIT_ACTIONS.VIEW_USERS), ...c.listAllUsers);

// Super-admin-only cross-tenant suspend/activate (target user + tenant in body).
// MUST precede '/users/:email/status' so 'all' isn't captured as an :email param.
router.put('/users/all/status',
  ...superAdminOnly, auditLog(AUDIT_CATEGORIES.USER_MGMT, 'WARN', AUDIT_ACTIONS.UPDATE_USER_STATUS), ...c.updateUserStatusCrossTenant);

router.get('/users/:email/roles',
  ...adminOnly, auditLog(AUDIT_CATEGORIES.USER_MGMT, 'DEBUG', AUDIT_ACTIONS.VIEW_USER_ROLES), ...c.getUserRoles);

router.get('/users/:email',
  ...adminOnly, auditLog(AUDIT_CATEGORIES.USER_MGMT, 'DEBUG', AUDIT_ACTIONS.VIEW_USER_DETAIL), ...c.getUserDetail);

router.put('/users/:email/roles',
  ...adminOnly, auditLog(AUDIT_CATEGORIES.USER_MGMT, 'INFO', AUDIT_ACTIONS.UPDATE_USER_ROLES), ...c.updateUserRoles);

router.put('/users/:email/status',
  ...adminOnly, auditLog(AUDIT_CATEGORIES.USER_MGMT, 'WARN', AUDIT_ACTIONS.UPDATE_USER_STATUS), ...c.updateUserStatus);

router.delete('/users/:email',
  ...adminOnly, auditLog(AUDIT_CATEGORIES.USER_MGMT, 'WARN', AUDIT_ACTIONS.REMOVE_USER), ...c.removeUser);

// ── Role management ───────────────────────────────────────────────────────────
router.get('/roles',
  ...adminOnly, auditLog(AUDIT_CATEGORIES.ROLE_MGMT, 'DEBUG', AUDIT_ACTIONS.VIEW_ROLES), ...c.listRoles);

router.post('/roles',
  ...adminOnly, auditLog(AUDIT_CATEGORIES.ROLE_MGMT, 'INFO', AUDIT_ACTIONS.CREATE_ROLE), ...c.createRole);

router.put('/roles/:roleId',
  ...adminOnly, auditLog(AUDIT_CATEGORIES.ROLE_MGMT, 'INFO', AUDIT_ACTIONS.UPDATE_ROLE), ...c.updateRole);

router.delete('/roles/:roleId',
  ...adminOnly, auditLog(AUDIT_CATEGORIES.ROLE_MGMT, 'WARN', AUDIT_ACTIONS.DELETE_ROLE), ...c.deleteRole);

router.get('/roles/:roleId/permissions',
  ...adminOnly, auditLog(AUDIT_CATEGORIES.ROLE_MGMT, 'DEBUG', AUDIT_ACTIONS.VIEW_ROLE_PERMISSIONS), ...c.getRolePermissions);

router.put('/roles/:roleId/permissions',
  ...adminOnly, auditLog(AUDIT_CATEGORIES.ROLE_MGMT, 'INFO', AUDIT_ACTIONS.UPDATE_ROLE_PERMISSIONS), ...c.setRolePermissions);

// ── Feature management ────────────────────────────────────────────────────────
router.get('/features',
  ...adminOnly, auditLog(AUDIT_CATEGORIES.FEATURE_MGMT, 'DEBUG', AUDIT_ACTIONS.VIEW_FEATURES), ...c.listFeatures);

router.post('/features',
  ...adminOnly, auditLog(AUDIT_CATEGORIES.FEATURE_MGMT, 'INFO', AUDIT_ACTIONS.CREATE_FEATURE), ...c.createFeature);

router.put('/features/:featureId',
  ...adminOnly, auditLog(AUDIT_CATEGORIES.FEATURE_MGMT, 'INFO', AUDIT_ACTIONS.UPDATE_FEATURE), ...c.updateFeature);

router.delete('/features/:featureId',
  ...adminOnly, auditLog(AUDIT_CATEGORIES.FEATURE_MGMT, 'WARN', AUDIT_ACTIONS.DELETE_FEATURE), ...c.deleteFeature);

module.exports = router;
