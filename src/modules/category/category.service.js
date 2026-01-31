// src/modules/category/category.service.js
// Category Service extending BaseCRUDService
// Handles business logic for category operations with standardized patterns

const BaseCRUDService = require('../../common/BaseCRUDService');
const { QUERIES } = require('../../config/constants');
const { logger } = require('../../utils/logger');

/**
 * Category Service extending base CRUD functionality
 */
class CategoryService extends BaseCRUDService {
  constructor() {
    super('Category', QUERIES.CATEGORY);
  }

  /**
   * Prepare parameters for category insertion
   * @param {string} id - Generated ID
   * @param {Object} data - Category data
   * @param {string} tenantId - Tenant ID
   * @param {string} userEmail - User email
   * @returns {Array} Parameters for INSERT query
   */
  prepareInsertParams(id, data, tenantId, userEmail) {
    return [
      id,
      tenantId,
      data.Name,
      data.Active !== undefined ? data.Active : true,
      userEmail,
      userEmail,
    ];
  }

  /**
   * Prepare parameters for category update
   * @param {Object} data - New data
   * @param {Object} existing - Existing record
   * @param {string} userEmail - User email
   * @param {string} id - Record ID
   * @param {string} tenantId - Tenant ID
   * @returns {Array} Parameters for UPDATE query
   */
  prepareUpdateParams(data, existing, userEmail, id, tenantId) {
    const updatedName = data.Name !== undefined ? data.Name : existing.Name;
    const updatedActive =
      data.Active !== undefined ? data.Active : existing.Active;

    return [updatedName, updatedActive, userEmail, id, tenantId];
  }

  /**
   * Get all categories for a tenant with pagination.
   * @param {string} tenantId - Tenant ID
   * @param {number} page - Page number
   * @param {number} limit - Items per page
   * @returns {Promise<Object>} Paginated results
   */
  async getAllCategories(tenantId, page = 1, limit = 10) {
    logger.info('CategoryService.getAllCategories called', {
      tenantId,
      page,
      limit,
    });
    return await this.getAll(tenantId, page, limit);
  }

  /**
   * Get category by ID.
   * @param {string} id - Category ID
   * @param {string} tenantId - Tenant ID
   * @returns {Promise<Object>} Category object
   */
  async getCategoryById(id, tenantId) {
    logger.info('CategoryService.getCategoryById called', { id, tenantId });
    return await this.getById(id, tenantId);
  }

  /**
   * Create new category.
   * @param {Object} categoryData - Category data
   * @param {string} tenantId - Tenant ID
   * @param {string} userEmail - User email
   * @returns {Promise<Object>} Created category
   */
  async createCategory(categoryData, tenantId, userEmail) {
    logger.info('CategoryService.createCategory called', {
      tenantId,
      userEmail,
    });
    return await this.create(categoryData, tenantId, userEmail);
  }

  /**
   * Update existing category.
   * @param {string} id - Category ID
   * @param {Object} updateData - Updated data
   * @param {string} tenantId - Tenant ID
   * @param {string} userEmail - User email
   * @returns {Promise<Object>} Updated category
   */
  async updateCategory(id, updateData, tenantId, userEmail) {
    logger.info('CategoryService.updateCategory called', {
      id,
      tenantId,
      userEmail,
    });
    return await this.update(id, updateData, tenantId, userEmail);
  }

  /**
   * Delete category.
   * @param {string} id - Category ID
   * @param {string} tenantId - Tenant ID
   * @returns {Promise<void>}
   */
  async deleteCategory(id, tenantId) {
    logger.info('CategoryService.deleteCategory called', { id, tenantId });
    return await this.delete(id, tenantId);
  }
}

// Create singleton instance
const categoryService = new CategoryService();

module.exports = {
  getAllCategories: (tenantId, page, limit) =>
    categoryService.getAllCategories(tenantId, page, limit),
  getCategoryById: (id, tenantId) =>
    categoryService.getCategoryById(id, tenantId),
  createCategory: (data, tenantId, userEmail) =>
    categoryService.createCategory(data, tenantId, userEmail),
  updateCategory: (id, data, tenantId, userEmail) =>
    categoryService.updateCategory(id, data, tenantId, userEmail),
  deleteCategory: (id, tenantId) =>
    categoryService.deleteCategory(id, tenantId),
};
