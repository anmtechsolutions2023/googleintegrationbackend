// src/modules/posfloor/posfloor.routes.js
// POS Floor routes — CRUD operations. Every route is audit-logged (AUDIT_CATEGORIES.POS).

const express = require('express');
const router = express.Router();
const {
  authenticateToken,
  checkScope,
} = require('../../middleware/authMiddleware');
const { auditLogCrud } = require('../../middleware/auditLogger');
const { SCOPES, SCOPE_SETS, AUDIT_CATEGORIES } = require('../../config/constants');
const controller = require('./posfloor.controller');

const audit = auditLogCrud('POS Floor', AUDIT_CATEGORIES.POS);

// Reading this list is shared POS reference data: a till, the KDS and the
// venue report all need it to draw themselves, so gating it on POS_CONFIG
// alone offered those screens and then refused their contents. The set that
// says so is SCOPE_SETS.POS_REFERENCE_READ in config/constants.js.
//
// WRITE below is untouched — POS_CONFIG:WRITE still owns changing any of it.
const READ = checkScope(...SCOPE_SETS.POS_REFERENCE_READ);

/** GET / — list all POS Floor records for the tenant. */
router.get('/', authenticateToken,
  READ, audit, ...controller.getAll);

/** GET /:id — get one POS Floor by ID. */
router.get('/:id', authenticateToken,
  READ, audit, ...controller.getById);

/** POST / — create a POS Floor. */
router.post(
  '/',
  authenticateToken,
  checkScope(SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.POS_CONFIG_WRITE),
  audit,
  ...controller.create
);

/** PUT /:id — update a POS Floor. */
router.put(
  '/:id',
  authenticateToken,
  checkScope(SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.POS_CONFIG_WRITE),
  audit,
  ...controller.update
);

/** DELETE /:id — delete a POS Floor. */
router.delete(
  '/:id',
  authenticateToken,
  checkScope(SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.POS_CONFIG_WRITE),
  audit,
  ...controller.deleteById
);

module.exports = router;
