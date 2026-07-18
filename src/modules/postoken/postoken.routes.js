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
router.get('/', authenticateToken, audit, ...controller.getAll);

/** GET /:id — get one POS Token by ID. */
router.get('/:id', authenticateToken, audit, ...controller.getById);

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

/** DELETE /:id — delete a POS Token. */
router.delete(
  '/:id',
  authenticateToken,
  checkScope(SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.POS_OPS_WRITE),
  audit,
  ...controller.deleteById
);

module.exports = router;
