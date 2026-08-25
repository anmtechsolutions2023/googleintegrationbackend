// src/modules/posorder/posorder.routes.js
// POS Order routes — CRUD operations. Every route is audit-logged (AUDIT_CATEGORIES.POS).

const express = require('express');
const router = express.Router();
const {
  authenticateToken,
  checkScope,
} = require('../../middleware/authMiddleware');
const { auditLogCrud } = require('../../middleware/auditLogger');
const { SCOPES, SCOPE_SETS, AUDIT_CATEGORIES } = require('../../config/constants');
const controller = require('./posorder.controller');

const audit = auditLogCrud('POS Order', AUDIT_CATEGORIES.POS);

// Listing orders is order work — plus the kitchen display, which is a list of
// the orders being cooked and cannot render without it.
const LIST = checkScope(
  SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN,
  SCOPES.POS_ORDER_READ, SCOPES.POS_ORDER_WRITE,
  SCOPES.POS_KITCHEN_READ, SCOPES.POS_KITCHEN_WRITE,
);

// Opening ONE order is different: the order-link modal is reached from the
// token queue, a customer's history, a ledger invoice and the dashboard, none
// of which is gated on POS_ORDER. Each of those screens is already showing a
// reference to the order — following it is a read of what is on screen.
// Creating, changing or voiding an order stays on POS_ORDER:WRITE below.
const DETAIL = checkScope(...SCOPE_SETS.POS_ORDER_REFERENCE_READ);

/** GET / — list all POS Order records for the tenant. */
router.get('/', authenticateToken, LIST, audit, ...controller.getAll);

/**
 * GET /:id/detail — the round with its token, kitchen tickets and invoice.
 * Declared BEFORE /:id so 'detail' is not read as part of an id.
 */
router.get('/:id/detail', authenticateToken, DETAIL, audit, ...controller.getDetail);

/** GET /:id — get one POS Order by ID. */
router.get('/:id', authenticateToken, DETAIL, audit, ...controller.getById);

/** POST / — create a POS Order. */
router.post(
  '/',
  authenticateToken,
  checkScope(SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.POS_ORDER_WRITE),
  audit,
  ...controller.create
);

/** PUT /:id — update a POS Order. */
router.put(
  '/:id',
  authenticateToken,
  checkScope(SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.POS_ORDER_WRITE),
  audit,
  ...controller.update
);

/** DELETE /:id — delete a POS Order. */
router.delete(
  '/:id',
  authenticateToken,
  checkScope(SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.POS_ORDER_WRITE),
  audit,
  ...controller.deleteById
);

/** POST /transfer — domain action: move items / rounds between tables (keep-as-served). */
router.post(
  '/transfer',
  authenticateToken,
  checkScope(SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.POS_ORDER_WRITE),
  auditLogCrud('POS Order Transfer', AUDIT_CATEGORIES.POS),
  ...controller.transfer,
);

/** POST /:id/fire-kot — domain action: fire a KOT from this order. */
router.post(
  '/:id/fire-kot',
  authenticateToken,
  checkScope(SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.POS_ORDER_WRITE),
  auditLogCrud('POS Fire KOT', AUDIT_CATEGORIES.POS),
  ...controller.fireKot
);

module.exports = router;
