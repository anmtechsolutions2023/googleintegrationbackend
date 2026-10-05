// src/modules/postable/postable.routes.js
// POS Table routes — CRUD operations. Every route is audit-logged (AUDIT_CATEGORIES.POS).

const express = require('express');
const router = express.Router();
const {
  authenticateToken,
  checkScope,
} = require('../../middleware/authMiddleware');
const { auditLogCrud } = require('../../middleware/auditLogger');
const { SCOPES, SCOPE_SETS, AUDIT_CATEGORIES } = require('../../config/constants');
const controller = require('./postable.controller');

const audit = auditLogCrud('POS Table', AUDIT_CATEGORIES.POS);

// Reading this list is shared POS reference data: a till, the KDS and the
// venue report all need it to draw themselves, so gating it on POS_CONFIG
// alone offered those screens and then refused their contents. The set that
// says so is SCOPE_SETS.POS_REFERENCE_READ in config/constants.js.
//
// WRITE below is untouched — POS_CONFIG:WRITE still owns changing any of it.
const READ = checkScope(...SCOPE_SETS.POS_REFERENCE_READ);

/** GET / — list all POS Table records for the tenant. */
router.get('/', authenticateToken,
  READ, audit, ...controller.getAll);

/** GET /:id — get one POS Table by ID. */
router.get('/:id', authenticateToken,
  READ, audit, ...controller.getById);

/** POST / — create a POS Table. */
router.post(
  '/',
  authenticateToken,
  checkScope(SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.POS_CONFIG_WRITE),
  audit,
  ...controller.create
);

/** PUT /:id — update a POS Table. */
router.put(
  '/:id',
  authenticateToken,
  checkScope(SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.POS_CONFIG_WRITE),
  audit,
  ...controller.update
);

/**
 * PUT /:id/occupancy — seat or free a table, from the till.
 *
 * The till marks a table occupied when its first round is saved and free when
 * the bill is settled. It used to do that through PUT /:id, which needs
 * POS_CONFIG:WRITE — a scope cashiers and waiters do not hold — so their order
 * or payment went through and THEN the request failed: the success message and
 * cart reset were skipped (inviting a duplicate round), or an error appeared
 * after the money was taken. This accepts the scopes the till's own actions
 * need, and can change nothing but the status and the current order.
 */
router.put(
  '/:id/occupancy',
  authenticateToken,
  checkScope(
    SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN,
    SCOPES.POS_ORDER_WRITE, SCOPES.POS_BILLING_WRITE,
  ),
  audit,
  ...controller.setOccupancy
);

/** DELETE /:id — delete a POS Table. */
router.delete(
  '/:id',
  authenticateToken,
  checkScope(SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.POS_CONFIG_WRITE),
  audit,
  ...controller.deleteById
);

module.exports = router;
