// src/modules/category/category.routes.js
// Category management routes - handles category CRUD operations.

const express = require('express');
const router = express.Router();
const {
  authenticateToken,
  checkScope,
} = require('../../middleware/authMiddleware');
const { auditLogCrud } = require('../../middleware/auditLogger');
const { SCOPES } = require('../../config/constants');
const categoryController = require('./category.controller');

/**
 * GET /api/categories
 * Get all categories for the authenticated user's tenant.
 */
router.get(
  '/',
  authenticateToken,
  checkScope(SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.MASTER_DATA_READ, SCOPES.MASTER_DATA_WRITE),
  auditLogCrud('Category'),
  ...categoryController.getAllCategories
);

/**
 * GET /api/categories/:id
 * Get a specific category by ID.
 */
router.get(
  '/:id',
  authenticateToken,
  checkScope(SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.MASTER_DATA_READ, SCOPES.MASTER_DATA_WRITE),
  auditLogCrud('Category'),
  ...categoryController.getCategoryById
);

/**
 * POST /api/categories
 * Create a new category.
 */
router.post(
  '/',
  authenticateToken,
  checkScope(SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.MASTER_DATA_WRITE),
  auditLogCrud('Category'),
  ...categoryController.createCategory
);

/**
 * PUT /api/categories/:id
 * Update an existing category.
 */
router.put(
  '/:id',
  authenticateToken,
  checkScope(SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.MASTER_DATA_WRITE),
  auditLogCrud('Category'),
  ...categoryController.updateCategory
);

/**
 * DELETE /api/categories/:id
 * Delete a category.
 */
router.delete(
  '/:id',
  authenticateToken,
  checkScope(SCOPES.TENANT_ADMIN, SCOPES.TENANT_SUPER_ADMIN, SCOPES.MASTER_DATA_WRITE),
  auditLogCrud('Category'),
  ...categoryController.deleteCategory
);

module.exports = router;
