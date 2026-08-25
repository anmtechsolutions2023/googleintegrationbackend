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
const { SCOPE_SETS, AUDIT_CATEGORIES } = require('../../config/constants');
const controller = require('./posbranch.controller');

// Every screen with a branch picker reads this, and they are not all POS
// screens: the asset register, the customer list and the finance reports all
// show one. Rather than listing scopes here and missing the next screen, this
// is the shared POS reference set — see config/constants.js.
router.get('/', authenticateToken,
  checkScope(...SCOPE_SETS.POS_REFERENCE_READ),
  auditLog(AUDIT_CATEGORIES.POS, 'DEBUG', 'POS branch list viewed'),
  ...controller.getAll);

module.exports = router;
