// src/modules/poscustomer/poscustomer.routes.js
// POS Customer routes — CRUD operations. Every route is audit-logged (AUDIT_CATEGORIES.POS).

const express = require('express');
const router = express.Router();
const {
  authenticateToken,
  checkScope,
} = require('../../middleware/authMiddleware');
const { auditLogCrud } = require('../../middleware/auditLogger');
const { SCOPES, AUDIT_CATEGORIES } = require('../../config/constants');
const controller = require('./poscustomer.controller');

const audit = auditLogCrud('POS Customer', AUDIT_CATEGORIES.POS);

/** GET / — list all POS Customer records for the tenant. */
router.get('/', authenticateToken,
  checkScope(SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.POS_CRM_READ, SCOPES.POS_CRM_WRITE), audit, ...controller.getAll);

/** GET /:id — get one POS Customer by ID. */
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
