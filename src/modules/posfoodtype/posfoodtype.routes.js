// src/modules/posfoodtype/posfoodtype.routes.js
// POS Food Type master routes — CRUD operations. Every route is IAM-governed
// (reads: POS_CONFIG READ/WRITE or admin; writes: POS_CONFIG_WRITE or admin)
// and audit-logged (AUDIT_CATEGORIES.POS).

const express = require('express');
const router = express.Router();
const {
  authenticateToken,
  checkScope,
} = require('../../middleware/authMiddleware');
const { auditLogCrud } = require('../../middleware/auditLogger');
const { SCOPES, AUDIT_CATEGORIES } = require('../../config/constants');
const controller = require('./posfoodtype.controller');

const audit = auditLogCrud('POS Food Type', AUDIT_CATEGORIES.POS);

// Viewing requires READ or WRITE on POS config (admins bypass).
const readAccess = checkScope(
  SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN,
  SCOPES.POS_CONFIG_READ, SCOPES.POS_CONFIG_WRITE,
);
// Mutating requires WRITE on POS config (admins bypass).
const writeAccess = checkScope(
  SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.POS_CONFIG_WRITE,
);

/** GET / — list all POS Food Type records for the tenant. */
router.get('/', authenticateToken, readAccess, audit, ...controller.getAll);

/** GET /:id — get one POS Food Type by ID. */
router.get('/:id', authenticateToken, readAccess, audit, ...controller.getById);

/** POST / — create a POS Food Type. */
router.post('/', authenticateToken, writeAccess, audit, ...controller.create);

/** PUT /:id — update a POS Food Type. */
router.put('/:id', authenticateToken, writeAccess, audit, ...controller.update);

/** DELETE /:id — delete a POS Food Type. */
router.delete('/:id', authenticateToken, writeAccess, audit, ...controller.deleteById);

module.exports = router;
