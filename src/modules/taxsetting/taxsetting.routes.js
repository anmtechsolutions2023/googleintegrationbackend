// src/modules/taxsetting/taxsetting.routes.js
// The tenant's GST switch. Configuration, so POS_CONFIG — the same scopes as the
// rest of POS Settings. A change is logged at WARN: it alters what every bill
// charges from the next order on.

const express = require('express');
const router = express.Router();
const { authenticateToken, checkScope } = require('../../middleware/authMiddleware');
const { auditLog } = require('../../middleware/auditLogger');
const { SCOPES, AUDIT_CATEGORIES } = require('../../config/constants');
const controller = require('./taxsetting.controller');

const readAccess = checkScope(
  SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN,
  SCOPES.POS_CONFIG_READ, SCOPES.POS_CONFIG_WRITE,
  // The export screen reads the setting to label a month; finance users hold
  // TRANSACTIONS rather than POS_CONFIG.
  SCOPES.TRANSACTIONS_READ, SCOPES.TRANSACTIONS_WRITE,
);
const writeAccess = checkScope(
  SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.POS_CONFIG_WRITE,
);

/** GET / — the switch, its history, and any open orders that would block it. */
router.get('/', authenticateToken, readAccess, ...controller.get);

/** PUT / — { gstCharging, offReason } */
router.put('/', authenticateToken, writeAccess,
  auditLog(AUDIT_CATEGORIES.POS, 'WARN', 'GST charging changed'), ...controller.update);

// A branch's GSTIN is its tax identity, so the people who manage the business's
// details may set it as well as those who configure the POS.
const gstinWriteAccess = checkScope(
  SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.POS_CONFIG_WRITE, SCOPES.ORGANIZATION_WRITE,
);

/** PUT /branches/:branchId/gstin — { gstin } (blank clears it) */
router.put('/branches/:branchId/gstin', authenticateToken, gstinWriteAccess,
  auditLog(AUDIT_CATEGORIES.POS, 'WARN', 'Branch GSTIN changed'), ...controller.updateBranchGstin);

module.exports = router;
