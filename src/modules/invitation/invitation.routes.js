// src/modules/invitation/invitation.routes.js
// Tenant invitations — the tenant admin's way to add somebody to their tenancy.
//
// Deliberately NOT super-admin-only: this is the route that gives a tenant
// admin the ability to manage their own membership, which they have never had.
// Safe to widen because every handler takes its tenancy from req.user.tid and
// no endpoint here can name another tenancy.

const express = require('express');
const router = express.Router();
const { authenticateToken, checkScope } = require('../../middleware/authMiddleware');
const { auditLog } = require('../../middleware/auditLogger');
const { SCOPES, AUDIT_CATEGORIES } = require('../../config/constants');
const controller = require('./invitation.controller');

const tenantAdmin = [
  authenticateToken,
  checkScope(SCOPES.ADMIN_ACCESS, SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN),
];

/** GET / — invitations this tenancy has raised. */
router.get('/', ...tenantAdmin,
  auditLog(AUDIT_CATEGORIES.USER_MGMT, 'DEBUG', 'Invitations viewed'), ...controller.list);

/** POST / — invite an email into this tenancy. */
router.post('/', ...tenantAdmin,
  auditLog(AUDIT_CATEGORIES.USER_MGMT, 'INFO', 'User invited'), ...controller.create);

/** DELETE /:id — withdraw a pending invitation. */
router.delete('/:id', ...tenantAdmin,
  auditLog(AUDIT_CATEGORIES.USER_MGMT, 'WARN', 'Invitation revoked'), ...controller.revoke);

module.exports = router;
