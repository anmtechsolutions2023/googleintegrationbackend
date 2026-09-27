// src/modules/businessprofile/businessprofile.routes.js
//
// Everything onboarding collected, in one place.
//
// READS need ORGANIZATION:READ or POS_CONFIG:READ. This is the business's own
// identity rather than a till's reference data, so it is NOT opened to every scope
// that can operate a POS the way receipt-format reads are: a cashier has no reason
// to read the proprietor's email address, and the masthead they DO need already
// reaches them through the receipt format.
//
// WRITES need ORGANIZATION:WRITE or POS_CONFIG:WRITE, matching every module this
// facade writes through. It grants nothing that a determined user could not already
// do via the four underlying CRUD endpoints — it makes doing it atomic.

const express = require('express');
const router = express.Router();
const { authenticateToken, checkScope } = require('../../middleware/authMiddleware');
const { auditLog } = require('../../middleware/auditLogger');
const { SCOPES, AUDIT_CATEGORIES } = require('../../config/constants');
const controller = require('./businessprofile.controller');

const readAccess = checkScope(
  SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN,
  SCOPES.ORGANIZATION_READ, SCOPES.ORGANIZATION_WRITE,
  SCOPES.POS_CONFIG_READ, SCOPES.POS_CONFIG_WRITE,
);
const writeAccess = checkScope(
  SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN,
  SCOPES.ORGANIZATION_WRITE, SCOPES.POS_CONFIG_WRITE,
);

/** GET /?branchId= — the whole profile, plus what of it prints. */
router.get('/', authenticateToken, readAccess, ...controller.get);

/**
 * PUT /?branchId= — { business?, address?, contact?, tax? }
 *
 * WARN, not INFO: this changes the name, address and tax identity printed on every
 * bill the branch issues from here on. That belongs in the audit trail at the same
 * level as moving the GST switch.
 */
router.put('/', authenticateToken, writeAccess,
  // MASTER_DATA, because that is the category the organisation, branch, address
  // and contact records are already audited under by their own CRUD routes. A
  // category of its own would split one table's history across two filters.
  auditLog(AUDIT_CATEGORIES.MASTER_DATA, 'WARN', 'Business profile updated'),
  ...controller.update);

module.exports = router;
