// src/modules/posaddongroup/posaddongroup.routes.js
// POS Add-on Group master routes — CRUD operations. Every route is IAM-governed
// (reads: POS reference read set or admin; writes: POS_CONFIG_WRITE or admin)
// and audit-logged (AUDIT_CATEGORIES.POS).

const express = require('express');
const router = express.Router();
const {
  authenticateToken,
  checkScope,
} = require('../../middleware/authMiddleware');
const { auditLogCrud } = require('../../middleware/auditLogger');
const { SCOPES, SCOPE_SETS, AUDIT_CATEGORIES } = require('../../config/constants');
const controller = require('./posaddongroup.controller');

const audit = auditLogCrud('POS Add-on Group', AUDIT_CATEGORIES.POS);

// Shared POS reference data, exactly like pos_food_type: the menu editor reads
// it, and so does anything that has to label a dish. A read follows the
// capability that needs it, not the module that owns it.
const readAccess = checkScope(...SCOPE_SETS.POS_REFERENCE_READ);
// Mutating requires WRITE on POS config (admins bypass).
const writeAccess = checkScope(
  SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.POS_CONFIG_WRITE,
);

/** GET / — list all POS Add-on Group records for the tenant. */
router.get('/', authenticateToken, readAccess, audit, ...controller.getAll);

/** GET /:id — get one POS Add-on Group by ID. */
router.get('/:id', authenticateToken, readAccess, audit, ...controller.getById);

/** POST / — create a POS Add-on Group. */
router.post('/', authenticateToken, writeAccess, audit, ...controller.create);

/** PUT /:id — update a POS Add-on Group. */
router.put('/:id', authenticateToken, writeAccess, audit, ...controller.update);

/** DELETE /:id — delete a POS Add-on Group. */
router.delete('/:id', authenticateToken, writeAccess, audit, ...controller.deleteById);

module.exports = router;
