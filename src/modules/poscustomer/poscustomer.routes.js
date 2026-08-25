// src/modules/poscustomer/poscustomer.routes.js
// POS Customer routes — CRUD operations. Every route is audit-logged (AUDIT_CATEGORIES.POS).

const express = require('express');
const router = express.Router();
const {
  authenticateToken,
  checkScope,
} = require('../../middleware/authMiddleware');
const { auditLogCrud } = require('../../middleware/auditLogger');
const { SCOPES, SCOPE_SETS, AUDIT_CATEGORIES } = require('../../config/constants');
const controller = require('./poscustomer.controller');

const audit = auditLogCrud('POS Customer', AUDIT_CATEGORIES.POS);

/** GET / — list all POS Customer records for the tenant. */
// Looking a customer up, for a screen that attaches one to something. The
// picker on the till searches this and opens the profile beside the bill —
// putting a customer on an order is part of taking it. Browsing and editing the
// CRM list itself stays on POS_CRM below. See SCOPE_SETS in config/constants.js.
const LOOKUP = checkScope(...SCOPE_SETS.POS_CUSTOMER_LOOKUP_READ);

router.get('/', authenticateToken,
  checkScope(SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.POS_CRM_READ, SCOPES.POS_CRM_WRITE), audit, ...controller.getAll);

/** GET /:id — get one POS Customer by ID. */
/**
 * GET /search?q= — find a customer at the counter, by phone or name.
 * GET /:id/profile — their spend, order history and ratings.
 * Both declared BEFORE /:id, or 'search' is parsed as a customer id.
 */
router.get('/search', authenticateToken,
  LOOKUP, audit, ...controller.search);

router.get('/:id/profile', authenticateToken,
  LOOKUP, audit, ...controller.getProfile);

router.get('/:id', authenticateToken,
  checkScope(SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.POS_CRM_READ, SCOPES.POS_CRM_WRITE), audit, ...controller.getById);

/** POST / — create a POS Customer. */
router.post(
  '/',
  authenticateToken,
  checkScope(SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.POS_CRM_WRITE),
  audit,
  ...controller.create
);

/** PUT /:id — update a POS Customer. */
router.put(
  '/:id',
  authenticateToken,
  checkScope(SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.POS_CRM_WRITE),
  audit,
  ...controller.update
);

/** DELETE /:id — delete a POS Customer. */
router.delete(
  '/:id',
  authenticateToken,
  checkScope(SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.POS_CRM_WRITE),
  audit,
  ...controller.deleteById
);

module.exports = router;
