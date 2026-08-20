// src/modules/possetting/possetting.routes.js
// Per-branch POS settings — IAM-governed (reads: POS_CONFIG READ/WRITE or admin;
// writes: POS_CONFIG_WRITE or admin) and audit-logged (AUDIT_CATEGORIES.POS).
//
// These are configuration, not operations: changing how a branch numbers its
// tokens is the same kind of act as editing the menu, so it shares POS_CONFIG
// rather than the POS_OPS scope the token queue itself runs under.

const express = require('express');
const router = express.Router();
const {
  authenticateToken,
  checkScope,
} = require('../../middleware/authMiddleware');
const { auditLog } = require('../../middleware/auditLogger');
const { SCOPES, AUDIT_CATEGORIES } = require('../../config/constants');
const controller = require('./possetting.controller');

const readAccess = checkScope(
  SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN,
  SCOPES.POS_CONFIG_READ, SCOPES.POS_CONFIG_WRITE,
);
const writeAccess = checkScope(
  SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.POS_CONFIG_WRITE,
);

/** GET /?branchId= — settings for one branch, defaults filled in. */
router.get('/', authenticateToken, readAccess,
  auditLog(AUDIT_CATEGORIES.POS, 'DEBUG', 'POS settings viewed'), ...controller.getForBranch);

/** PUT /?branchId= — upsert one or more settings for a branch. */
router.put('/', authenticateToken, writeAccess,
  auditLog(AUDIT_CATEGORIES.POS, 'INFO', 'POS settings updated'), ...controller.updateForBranch);

module.exports = router;
