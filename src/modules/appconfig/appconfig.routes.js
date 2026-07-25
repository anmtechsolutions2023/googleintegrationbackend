// src/modules/appconfig/appconfig.routes.js
// Global Application Configuration — SUPER-ADMIN only. Governs system-wide,
// pre-tenant settings (currently the onboarding auto-approval flag).

const express = require('express');
const router = express.Router();
const { authenticateToken, checkScope } = require('../../middleware/authMiddleware');
const { auditLog } = require('../../middleware/auditLogger');
const { SCOPES, AUDIT_CATEGORIES, AUDIT_ACTIONS } = require('../../config/constants');
const c = require('./appconfig.controller');

// checkScope(TENANT_SUPER_ADMIN) admits only super-admins: the super-admin
// bypass grants access, while regular admins fail the required-scope check.
const superAdminOnly = [authenticateToken, checkScope(SCOPES.TENANT_SUPER_ADMIN)];

router.get('/',
  ...superAdminOnly, auditLog(AUDIT_CATEGORIES.GENERAL, 'DEBUG', AUDIT_ACTIONS.VIEW_APP_CONFIG), ...c.getConfig);

router.patch('/',
  ...superAdminOnly, auditLog(AUDIT_CATEGORIES.GENERAL, 'INFO', AUDIT_ACTIONS.UPDATE_APP_CONFIG), ...c.updateConfig);

module.exports = router;
