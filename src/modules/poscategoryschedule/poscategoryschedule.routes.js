// src/modules/poscategoryschedule/poscategoryschedule.routes.js
// Category availability windows. Mounted at /api/pos/category-schedules.
//
// IAM matches the other POS Setup screens: reads take the POS reference set
// (a till has to know whether a category is on the menu), writes take
// POS_CONFIG:WRITE. Audit-logged under AUDIT_CATEGORIES.POS.

const express = require('express');
const router = express.Router();
const {
  authenticateToken,
  checkScope,
} = require('../../middleware/authMiddleware');
const { auditLogCrud } = require('../../middleware/auditLogger');
const { SCOPES, SCOPE_SETS, AUDIT_CATEGORIES } = require('../../config/constants');
const controller = require('./poscategoryschedule.controller');

const audit = auditLogCrud('POS Category Schedule', AUDIT_CATEGORIES.POS);

const readAccess = checkScope(...SCOPE_SETS.POS_REFERENCE_READ);
const writeAccess = checkScope(
  SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.POS_CONFIG_WRITE,
);

/** GET / — every rule in the tenancy, for a menu push. */
router.get('/', authenticateToken, readAccess, audit, ...controller.getAllForTenant);

/** GET /:categoryId — one category's week. */
router.get('/:categoryId', authenticateToken, readAccess, audit, ...controller.getForCategory);

/**
 * PUT /:categoryId — replace the category's whole week.
 * An empty Rules array clears it, returning the category to always-available.
 */
router.put('/:categoryId', authenticateToken, writeAccess, audit, ...controller.replaceForCategory);

/** DELETE /:categoryId — clear the schedule. */
router.delete('/:categoryId', authenticateToken, writeAccess, audit, ...controller.clearForCategory);

module.exports = router;
