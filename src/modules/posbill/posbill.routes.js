// src/modules/posbill/posbill.routes.js
// POS Bill routes — CRUD operations. Every route is audit-logged (AUDIT_CATEGORIES.POS).

const express = require('express');
const router = express.Router();
const {
  authenticateToken,
  checkScope,
} = require('../../middleware/authMiddleware');
const { auditLogCrud } = require('../../middleware/auditLogger');
const { SCOPES, AUDIT_CATEGORIES } = require('../../config/constants');
const controller = require('./posbill.controller');

const audit = auditLogCrud('POS Bill', AUDIT_CATEGORIES.POS);

/** GET / — list all POS Bill records for the tenant. */
router.get('/', authenticateToken,
  checkScope(SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.POS_BILLING_READ, SCOPES.POS_BILLING_WRITE), audit, ...controller.getAll);

/** GET /:id — get one POS Bill by ID. */
router.get('/:id', authenticateToken,
  checkScope(SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.POS_BILLING_READ, SCOPES.POS_BILLING_WRITE), audit, ...controller.getById);

/** POST / — create a POS Bill. */
router.post(
  '/',
  authenticateToken,
  checkScope(SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.POS_BILLING_WRITE),
  audit,
  ...controller.create
);

/** PUT /:id — update a POS Bill. */
router.put(
  '/:id',
  authenticateToken,
  checkScope(SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.POS_BILLING_WRITE),
  audit,
  ...controller.update
);

/** DELETE /:id — delete a POS Bill. */
router.delete(
  '/:id',
  authenticateToken,
  checkScope(SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.POS_BILLING_WRITE),
  audit,
  ...controller.deleteById
);

/** POST /:id/settle — domain action: record payments and mark the bill paid. */
router.post(
  '/:id/settle',
  authenticateToken,
  checkScope(SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.POS_BILLING_WRITE),
  auditLogCrud('POS Bill Settle', AUDIT_CATEGORIES.POS),
  ...controller.settle
);

module.exports = router;
