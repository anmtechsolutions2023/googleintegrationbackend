// src/modules/import/import.routes.js
//
// Bulk operations are a TENANT ADMIN act, and only that.
//
// Deliberately narrower than the scopes the individual screens use. One request
// here creates categories, units, tax groups, items and menu entries across a
// whole tenancy — the blast radius of a bad file is the catalogue, not a row.
// A POS manager with POS_CONFIG:WRITE can edit a menu item; they cannot rewrite
// the menu. Anyone who needs that is an administrator.
//
// This is also why there is no cross-tenant variant: the tenancy comes from the
// token, so an import can only ever land in the caller's own.

const express = require('express');
const router = express.Router();
const { authenticateToken, checkScope } = require('../../middleware/authMiddleware');
const { auditLog } = require('../../middleware/auditLogger');
const { SCOPES, AUDIT_CATEGORIES } = require('../../config/constants');
const c = require('./import.controller');

const tenantAdminOnly = [
  authenticateToken,
  checkScope(SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN),
];

/** POST /items — catalogue items, with their categories, units and prices. */
router.post('/items',
  ...tenantAdminOnly,
  auditLog(AUDIT_CATEGORIES.MASTER_DATA, 'INFO', 'Bulk item import'),
  ...c.importItems);

/** POST /menu-entries — publish catalogue items onto one branch's menu. */
router.post('/menu-entries',
  ...tenantAdminOnly,
  auditLog(AUDIT_CATEGORIES.POS, 'INFO', 'Bulk menu publish'),
  ...c.importMenuEntries);

/** POST /preview — read-only checks the browser cannot make for itself. */
router.post('/preview',
  ...tenantAdminOnly,
  ...c.previewTaxGroups);

module.exports = router;
