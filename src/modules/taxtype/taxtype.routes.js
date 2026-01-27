// src/modules/taxtype/taxtype.routes.js
// Tax type management routes - handles tax type CRUD operations.

const express = require('express');
const router = express.Router();
const {
  authenticateToken,
  checkScope,
} = require('../../middleware/authMiddleware');
const { auditLog } = require('../../middleware/auditLogger');
const { validateUuidParam } = require('../../middleware/validation');
const { SCOPES } = require('../../config/constants');
const taxtypeController = require('./taxtype.controller');

/**
 * GET /api/taxtypes
 * Get all tax types for the authenticated user's tenant.
 */
router.get(
  '/',
  authenticateToken,
  auditLog(),
  ...taxtypeController.getAllTaxTypes
);

/**
 * GET /api/taxtypes/:id
 * Get a specific tax type by ID.
 */
router.get(
  '/:id',
  authenticateToken,
  auditLog(),
  ...taxtypeController.getTaxTypeById
);

/**
 * POST /api/taxtypes
 * Create a new tax type.
 */
router.post(
  '/',
  authenticateToken,
  checkScope(SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN),
  auditLog(),
  ...taxtypeController.createTaxType
);

/**
 * PUT /api/taxtypes/:id
 * Update an existing tax type.
 */
router.put(
  '/:id',
  authenticateToken,
  checkScope(SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN),
  auditLog(),
  ...taxtypeController.updateTaxType
);

/**
 * DELETE /api/taxtypes/:id
 * Delete a tax type.
 */
router.delete(
  '/:id',
  authenticateToken,
  checkScope(SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN),
  auditLog(),
  ...taxtypeController.deleteTaxType
);

module.exports = router;
