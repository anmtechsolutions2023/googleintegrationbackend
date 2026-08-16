// src/modules/posexpense/posexpense.routes.js
// POS Expense routes — CRUD operations. Every route is audit-logged (AUDIT_CATEGORIES.POS).

const express = require('express');
const router = express.Router();
const {
  authenticateToken,
  checkScope,
} = require('../../middleware/authMiddleware');
const { auditLogCrud, auditLog } = require('../../middleware/auditLogger');
const { SCOPES, AUDIT_CATEGORIES } = require('../../config/constants');
const controller = require('./posexpense.controller');

const audit = auditLogCrud('POS Expense', AUDIT_CATEGORIES.POS);

/** GET / — list all POS Expense records for the tenant. */
router.get('/', authenticateToken,
  checkScope(SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.POS_OPS_READ, SCOPES.POS_OPS_WRITE), audit, ...controller.getAll);

/** GET /:id — get one POS Expense by ID. */
router.get('/:id', authenticateToken,
  checkScope(SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.POS_OPS_READ, SCOPES.POS_OPS_WRITE), audit, ...controller.getById);

/** POST / — create a POS Expense. */
router.post(
  '/',
  authenticateToken,
  checkScope(SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.POS_OPS_WRITE),
  audit,
  ...controller.create
);

/** PUT /:id — update a POS Expense. */
router.put(
  '/:id',
  authenticateToken,
  checkScope(SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.POS_OPS_WRITE),
  audit,
  ...controller.update
);

/** DELETE /:id — delete a POS Expense. */
router.delete(
  '/:id',
  authenticateToken,
  checkScope(SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.POS_OPS_WRITE),
  audit,
  ...controller.deleteById
);

// ── Approval flow ────────────────────────────────────────────────────────────
// Approve and reject need EXPENSE:APPROVE, deliberately NOT POS_OPS:WRITE: the
// cashier who raises a claim must not be able to approve their own spending.
const approveAudit = auditLog(AUDIT_CATEGORIES.PAYMENTS, 'WARN', 'Expense approval action');

/** POST /:id/approve — approve a draft expense. */
router.post(
  '/:id/approve',
  authenticateToken,
  checkScope(SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.EXPENSE_APPROVE),
  approveAudit,
  ...controller.approve
);

/** POST /:id/reject — reject a draft expense. */
router.post(
  '/:id/reject',
  authenticateToken,
  checkScope(SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.EXPENSE_APPROVE),
  approveAudit,
  ...controller.reject
);

/** POST /:id/settle — pay an approved expense and post it to the ledger. */
router.post(
  '/:id/settle',
  authenticateToken,
  checkScope(SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.EXPENSE_APPROVE),
  auditLog(AUDIT_CATEGORIES.PAYMENTS, 'WARN', 'Expense settled and posted'),
  ...controller.settle
);

module.exports = router;
