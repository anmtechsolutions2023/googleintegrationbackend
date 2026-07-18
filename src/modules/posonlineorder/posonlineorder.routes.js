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

/** GET / — list all POS Online Order records for the tenant. */
router.get('/', authenticateToken, audit, ...controller.getAll);

/** GET /:id — get one POS Online Order by ID. */
router.get('/:id', authenticateToken, audit, ...controller.getById);

/** POST / — create a POS Online Order. */
router.post(
  '/',
  authenticateToken,
  checkScope(SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.POS_OPS_WRITE),
  audit,
  ...controller.create
);

/** PUT /:id — update a POS Online Order. */
router.put(
  '/:id',
  authenticateToken,
  checkScope(SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.POS_OPS_WRITE),
  audit,
  ...controller.update
);

/** DELETE /:id — delete a POS Online Order. */
router.delete(
  '/:id',
  authenticateToken,
  checkScope(SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.POS_OPS_WRITE),
  audit,
  ...controller.deleteById
);

module.exports = router;
