// src/modules/posmenutag/posmenutag.routes.js
// POS Menu Tag master routes — CRUD plus a by-type lookup for pickers.
// Every route is IAM-governed and audit-logged (AUDIT_CATEGORIES.POS).

const express = require('express');
const router = express.Router();
const {
  authenticateToken,
  checkScope,
} = require('../../middleware/authMiddleware');
const { auditLogCrud } = require('../../middleware/auditLogger');
const { SCOPES, SCOPE_SETS, AUDIT_CATEGORIES } = require('../../config/constants');
const controller = require('./posmenutag.controller');

const audit = auditLogCrud('POS Menu Tag', AUDIT_CATEGORIES.POS);

const readAccess = checkScope(...SCOPE_SETS.POS_REFERENCE_READ);
const writeAccess = checkScope(
  SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.POS_CONFIG_WRITE,
);

/**
 * GET /type/:tagType — active tags of one type (CATEGORY | BEVERAGE | CUISINE).
 *
 * Registered BEFORE '/:id'. Express matches in declaration order, so the
 * literal segment has to come first or '/type/BEVERAGE' is read as an id of
 * 'type' and answers 404 for a route that exists.
 */
router.get('/type/:tagType', authenticateToken, readAccess, audit, ...controller.getByType);

/** GET / — list all POS Menu Tag records for the tenant. */
router.get('/', authenticateToken, readAccess, audit, ...controller.getAll);

/** GET /:id — get one POS Menu Tag by ID. */
router.get('/:id', authenticateToken, readAccess, audit, ...controller.getById);

/** POST / — create a POS Menu Tag. */
router.post('/', authenticateToken, writeAccess, audit, ...controller.create);

/** PUT /:id — update a POS Menu Tag. */
router.put('/:id', authenticateToken, writeAccess, audit, ...controller.update);

/** DELETE /:id — delete a POS Menu Tag. */
router.delete('/:id', authenticateToken, writeAccess, audit, ...controller.deleteById);

module.exports = router;
