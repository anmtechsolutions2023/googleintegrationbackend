// src/modules/posonlineorder/posonlineorder.routes.js
// POS Online Order routes — CRUD operations. Every route is audit-logged (AUDIT_CATEGORIES.POS).

const express = require('express');
const router = express.Router();
const {
  authenticateToken,
  checkScope,
} = require('../../middleware/authMiddleware');
const { auditLogCrud } = require('../../middleware/auditLogger');
const { SCOPES, AUDIT_CATEGORIES } = require('../../config/constants');
const controller = require('./posonlineorder.controller');

const audit = auditLogCrud('POS Online Order', AUDIT_CATEGORIES.POS);

// Watching the queue is a read anyone minding the shop may do; deciding what
// happens to an order is not. Unchanged from before — the domain actions below
// sit on the same WRITE scope the old status PUT did, so no role gains or loses
// anything by this feature.
const READ = checkScope(
  SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.POS_OPS_READ, SCOPES.POS_OPS_WRITE,
);
const WRITE = checkScope(
  SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.POS_OPS_WRITE,
);

/**
 * GET /queue — the expo screen's feed: open work only, oldest first.
 *
 * Declared before /:id so 'queue' is never captured as an order uuid.
 */
router.get('/queue', authenticateToken, READ, audit, ...controller.getQueue);

/** GET / — list all POS Online Order records for the tenant. */
router.get('/', authenticateToken, READ, audit, ...controller.getAll);

/** GET /:id — get one POS Online Order by ID. */
router.get('/:id', authenticateToken, READ, audit, ...controller.getById);

/** POST / — create a POS Online Order. */
router.post(
  '/',
  authenticateToken,
  WRITE,
  audit,
  ...controller.create
);

/** PUT /:id — update a POS Online Order. */
router.put(
  '/:id',
  authenticateToken,
  WRITE,
  audit,
  ...controller.update
);

/** DELETE /:id — delete a POS Online Order. */
router.delete(
  '/:id',
  authenticateToken,
  WRITE,
  audit,
  ...controller.deleteById
);

/**
 * POST /:id/accept — domain action: take the order into the POS.
 *
 * This is the endpoint that closes the gap the module was built with: it
 * creates the pos_order, fires the kitchen ticket and links the two, so an
 * aggregator order finally reaches the kitchen, the bill and the ledger by the
 * road every other sale already travels.
 */
router.post(
  '/:id/accept',
  authenticateToken,
  WRITE,
  auditLogCrud('POS Online Order Accept', AUDIT_CATEGORIES.POS),
  ...controller.accept,
);

/** POST /:id/reject — domain action: refuse it, with a coded reason. */
router.post(
  '/:id/reject',
  authenticateToken,
  WRITE,
  auditLogCrud('POS Online Order Reject', AUDIT_CATEGORIES.POS),
  ...controller.reject,
);

/**
 * PUT /:id/status — domain action: move it along.
 *
 * The single validated writer for every stage after accept. The plain PUT /:id
 * above still exists and still works, so nothing that called it breaks; this is
 * what the screens use, because it is the one that checks the move is legal
 * from where the order actually is.
 */
router.put(
  '/:id/status',
  authenticateToken,
  WRITE,
  auditLogCrud('POS Online Order Status', AUDIT_CATEGORIES.POS),
  ...controller.setStatus,
);

module.exports = router;
