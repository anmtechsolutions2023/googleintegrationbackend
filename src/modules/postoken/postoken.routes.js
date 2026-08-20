// src/modules/postoken/postoken.routes.js
// POS Token routes — CRUD operations. Every route is audit-logged (AUDIT_CATEGORIES.POS).

const express = require('express');
const router = express.Router();
const {
  authenticateToken,
  checkScope,
} = require('../../middleware/authMiddleware');
const { auditLogCrud } = require('../../middleware/auditLogger');
const { SCOPES, AUDIT_CATEGORIES } = require('../../config/constants');
const controller = require('./postoken.controller');

const audit = auditLogCrud('POS Token', AUDIT_CATEGORIES.POS);

/** GET / — list all POS Token records for the tenant. */
router.get('/', authenticateToken,
  checkScope(SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.POS_OPS_READ, SCOPES.POS_OPS_WRITE), audit, ...controller.getAll);

/**
 * GET /stats — queue performance for a date range.
 * Declared BEFORE /:id, or 'stats' is parsed as a token id and 400s on the
 * uuid check.
 */
router.get('/stats', authenticateToken,
  checkScope(SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.POS_OPS_READ,
    SCOPES.POS_OPS_WRITE, SCOPES.POS_REPORTS_READ), audit, ...controller.stats);

/** GET /:id — get one POS Token by ID. */
router.get('/:id', authenticateToken,
  checkScope(SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.POS_OPS_READ, SCOPES.POS_OPS_WRITE), audit, ...controller.getById);

/** POST / — create a POS Token. */
router.post(
  '/',
  authenticateToken,
  checkScope(SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.POS_OPS_WRITE),
  audit,
  ...controller.create
);

/** PUT /:id — update a POS Token. */
router.put(
  '/:id',
  authenticateToken,
  checkScope(SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.POS_OPS_WRITE),
  audit,
  ...controller.update
);

/**
 * POST /:id/call  — call the token to the counter.
 * POST /:id/serve — hand it over.
 * Domain actions rather than PUTs: each stamps its own timestamp, and a client
 * that had to send Status + CalledAt itself could disagree with the clock the
 * rest of the ledger runs on. Same shape as KOT mark-ready.
 */
router.post('/:id/call', authenticateToken,
  checkScope(SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.POS_OPS_WRITE),
  audit, ...controller.call);

router.post('/:id/serve', authenticateToken,
  checkScope(SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.POS_OPS_WRITE),
  audit, ...controller.serve);

/** DELETE /:id — delete a POS Token. */
router.delete(
  '/:id',
  authenticateToken,
  checkScope(SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.POS_OPS_WRITE),
  audit,
  ...controller.deleteById
);

module.exports = router;
