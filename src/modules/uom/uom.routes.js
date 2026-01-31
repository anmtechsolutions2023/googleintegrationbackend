// src/modules/uom/uom.routes.js
// UOM (Unit of Measure) management routes - handles UOM CRUD operations.

const express = require('express');
const router = express.Router();
const {
  authenticateToken,
  checkScope,
} = require('../../middleware/authMiddleware');
const { auditLog } = require('../../middleware/auditLogger');
const { SCOPES } = require('../../config/constants');
const uomController = require('./uom.controller');

/**
 * GET /api/uom
 * Get all UOMs for the authenticated user's tenant.
 */
router.get('/', authenticateToken, auditLog(), ...uomController.getAllUom);

/**
 * GET /api/uom/:id
 * Get a specific UOM by ID.
 */
router.get('/:id', authenticateToken, auditLog(), ...uomController.getUomById);

/**
 * POST /api/uom
 * Create a new UOM.
 */
router.post(
  '/',
  authenticateToken,
  checkScope(SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN),
  auditLog(),
  ...uomController.createUom
);

/**
 * PUT /api/uom/:id
 * Update an existing UOM.
 */
router.put(
  '/:id',
  authenticateToken,
  checkScope(SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN),
  auditLog(),
  ...uomController.updateUom
);

/**
 * DELETE /api/uom/:id
 * Delete a UOM.
 */
router.delete(
  '/:id',
  authenticateToken,
  checkScope(SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN),
  auditLog(),
  ...uomController.deleteUom
);

module.exports = router;
