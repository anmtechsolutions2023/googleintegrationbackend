// src/modules/posorder/posorder.routes.js
// POS Order routes — CRUD operations. Every route is audit-logged (AUDIT_CATEGORIES.POS).

const express = require('express');
const router = express.Router();
const {
  authenticateToken,
  checkScope,
} = require('../../middleware/authMiddleware');
const { auditLogCrud } = require('../../middleware/auditLogger');
const { SCOPES, AUDIT_CATEGORIES } = require('../../config/constants');
const controller = require('./posorder.controller');

const audit = auditLogCrud('POS Order', AUDIT_CATEGORIES.POS);

/** GET / — list all POS Order records for the tenant. */
router.get('/', authenticateToken,
  checkScope(SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.POS_ORDER_READ, SCOPES.POS_ORDER_WRITE), audit, ...controller.getAll);

/** GET /:id — get one POS Order by ID. */
router.get('/:id', authenticateToken,
  checkScope(SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.POS_ORDER_READ, SCOPES.POS_ORDER_WRITE), audit, ...controller.getById);

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
