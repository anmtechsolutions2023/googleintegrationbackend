// src/modules/posexpense/posexpense.routes.js
// POS Expense routes — CRUD operations. Every route is audit-logged (AUDIT_CATEGORIES.POS).

const express = require('express');
const router = express.Router();
const {
  authenticateToken,
  checkScope,
} = require('../../middleware/authMiddleware');
const { auditLogCrud } = require('../../middleware/auditLogger');
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

module.exports = router;
