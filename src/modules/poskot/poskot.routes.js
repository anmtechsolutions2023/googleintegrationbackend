// src/modules/poskot/poskot.routes.js
// POS KOT routes — CRUD operations. Every route is audit-logged (AUDIT_CATEGORIES.POS).

const express = require('express');
const router = express.Router();
const {
  authenticateToken,
  checkScope,
} = require('../../middleware/authMiddleware');
const { auditLogCrud } = require('../../middleware/auditLogger');
const { SCOPES, AUDIT_CATEGORIES } = require('../../config/constants');
const controller = require('./poskot.controller');

const audit = auditLogCrud('POS KOT', AUDIT_CATEGORIES.POS);

/** GET / — list all POS KOT records for the tenant. */
// Reading the tickets is part of taking an order, not only of cooking: the till
// shows which rounds have been fired before it will let another go, so Billing
// loads this list on every open. Gating the read on POS_KITCHEN alone meant a
// cashier's main screen 403'd unless they were also handed kitchen access.
//
// WRITE stays with POS_KITCHEN below — marking a ticket ready is the cook's
// call. Firing one is POS_ORDER:WRITE, on the order routes where it belongs.
const READ = [
  SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN,
  SCOPES.POS_KITCHEN_READ, SCOPES.POS_KITCHEN_WRITE,
  SCOPES.POS_ORDER_READ, SCOPES.POS_ORDER_WRITE,
  SCOPES.POS_BILLING_READ, SCOPES.POS_BILLING_WRITE,
];

router.get('/', authenticateToken,
  checkScope(...READ), audit, ...controller.getAll);

/** GET /:id — get one POS KOT by ID. */
router.get('/:id', authenticateToken,
  checkScope(...READ), audit, ...controller.getById);

/** POST / — create a POS KOT. */
router.post(
  '/',
  authenticateToken,
  checkScope(SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.POS_KITCHEN_WRITE),
  audit,
  ...controller.create
);

/** PUT /:id — update a POS KOT. */
router.put(
  '/:id',
  authenticateToken,
  checkScope(SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.POS_KITCHEN_WRITE),
  audit,
  ...controller.update
);

/** DELETE /:id — delete a POS KOT. */
router.delete(
  '/:id',
  authenticateToken,
  checkScope(SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.POS_KITCHEN_WRITE),
  audit,
  ...controller.deleteById
);

/** PATCH /:id/ready — domain action: mark a KOT ready (KDS). */
router.patch(
  '/:id/ready',
  authenticateToken,
  checkScope(SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.POS_KITCHEN_WRITE),
  auditLogCrud('POS KOT Ready', AUDIT_CATEGORIES.POS),
  ...controller.markReady
);

module.exports = router;
