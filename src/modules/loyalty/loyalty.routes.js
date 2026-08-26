// src/modules/loyalty/loyalty.routes.js
// Loyalty routes. Every route is audit-logged (AUDIT_CATEGORIES.POS) — a manual
// movement of points is exactly the kind of gesture an audit trail exists for.

const express = require('express');

const router = express.Router();
const { authenticateToken, checkScope } = require('../../middleware/authMiddleware');
const { auditLogCrud } = require('../../middleware/auditLogger');
const { SCOPES, SCOPE_SETS, AUDIT_CATEGORIES } = require('../../config/constants');
const controller = require('./loyalty.controller');

const audit = auditLogCrud('Loyalty', AUDIT_CATEGORIES.POS);

/**
 * GET /:id/statement — reads follow the capability that needs them.
 * The till shows a balance beside the bill, so whoever may look a customer up
 * may see what they hold: the same set that opens the customer profile.
 */
router.get('/:id/statement', authenticateToken,
  checkScope(...SCOPE_SETS.POS_CUSTOMER_LOOKUP_READ), audit, ...controller.getStatement);

/**
 * POST /:id/adjust — writes stay with the category that owns them.
 * Handing out points has real value, so it belongs to whoever owns the CRM,
 * not to everyone who can read a balance at the counter.
 */
router.post('/:id/adjust', authenticateToken,
  checkScope(SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.POS_CRM_WRITE),
  audit, ...controller.adjust);

module.exports = router;
