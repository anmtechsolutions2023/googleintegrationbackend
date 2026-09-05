// src/modules/category/category.controller.js
// Controller layer for Category operations
// Handles HTTP requests and responses with standardized patterns

const categoryService = require('./category.service');
const { asyncHandler } = require('../../utils/controllerHelper');
const {
  successResponse,
  paginatedResponse,
  createdResponse,
  noContentResponse,
} = require('../../utils/responseHelper');
const {
  validateBody,
  validateQuery,
  validateParams,
} = require('../../middleware/validation');
const {
  createCategorySchema,
  updateCategorySchema,
  paginationSchema,
  uuidParamSchema,
} = require('./category.schemas');
const { logger } = require('../../utils/logger');

/**
 * Get all categories with pagination
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const getAllCategories = asyncHandler(async (req, res) => {
  const { tid: tenantId } = req.user;
  const { page, limit } = req.query;

  logger.info('getAllCategories called', { tenantId, page, limit });

  const result = await categoryService.getAllCategories(tenantId, page, limit);

  paginatedResponse(
    res,
    result.data,
    result.pagination,
    'Categories retrieved successfully'
  );
});

/**
 * Get a specific category by ID
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const getCategoryById = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { tid: tenantId } = req.user;

  logger.info('getCategoryById called', { id, tenantId });

  const category = await categoryService.getCategoryById(id, tenantId);

  successResponse(res, category, 'Category retrieved successfully');
});

/**
 * Create a new category
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const createCategory = asyncHandler(async (req, res) => {
  const { tid: tenantId, phone } = req.user;
  const categoryData = req.body;

  logger.info('createCategory called', { tenantId, phone });

  const newCategory = await categoryService.createCategory(
    categoryData,
    tenantId,
    phone
  );

  createdResponse(res, newCategory, 'Category created successfully');
});

/**
 * Update an existing category
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const updateCategory = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { tid: tenantId, phone } = req.user;
  const updateData = req.body;

  logger.info('updateCategory called', { id, tenantId, phone });

  const updatedCategory = await categoryService.updateCategory(
    id,
    updateData,
    tenantId,
    phone
  );

  successResponse(res, updatedCategory, 'Category updated successfully');
});

/**
 * Delete a category
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const deleteCategory = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { tid: tenantId } = req.user;

  logger.info('deleteCategory called', { id, tenantId });

  await categoryService.deleteCategory(id, tenantId);

  noContentResponse(res, 'Category deleted successfully');
});

module.exports = {
  getAllCategories: [validateQuery(paginationSchema), getAllCategories],
  getCategoryById: [validateParams(uuidParamSchema), getCategoryById],
  createCategory: [validateBody(createCategorySchema), createCategory],
  updateCategory: [
    validateParams(uuidParamSchema),
    validateBody(updateCategorySchema),
    updateCategory,
  ],
  deleteCategory: [validateParams(uuidParamSchema), deleteCategory],
};
