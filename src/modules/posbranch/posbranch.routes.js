// src/modules/posbranch/posbranch.routes.js
// Branch names for POS screens — read only, and admitted on ANY POS read scope.
//
// Deliberately wider than the other POS routes: a cashier on POS_OPS, a manager
// on POS_CONFIG and a KDS on POS_KITCHEN all need to name the branch they are
// looking at, and none of them should need ORGANIZATION_READ (which
// /api/branchdetails requires) to render a dropdown. There is no write route
// here — branches are still created and edited through the organization module
// under its own scope.

const express = require('express');
const router = express.Router();
const {
  authenticateToken,
  checkScope,
} = require('../../middleware/authMiddleware');
const { auditLog } = require('../../middleware/auditLogger');
const { SCOPES, AUDIT_CATEGORIES } = require('../../config/constants');
const controller = require('./posbranch.controller');

router.get('/', authenticateToken,
  checkScope(
    SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN,
    SCOPES.POS_OPS_READ, SCOPES.POS_OPS_WRITE,
    SCOPES.POS_CONFIG_READ, SCOPES.POS_CONFIG_WRITE,
    SCOPES.POS_ORDER_READ, SCOPES.POS_ORDER_WRITE,
    SCOPES.POS_BILLING_READ, SCOPES.POS_BILLING_WRITE,
    SCOPES.POS_KITCHEN_READ, SCOPES.POS_KITCHEN_WRITE,
    SCOPES.ORGANIZATION_READ, SCOPES.ORGANIZATION_WRITE,
  ),
  auditLog(AUDIT_CATEGORIES.POS, 'DEBUG', 'POS branch list viewed'),
  ...controller.getAll);

module.exports = router;
