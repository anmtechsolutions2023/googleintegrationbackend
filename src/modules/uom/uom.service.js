// src/modules/uom/uom.service.js
// UOM (Unit of Measure) Service extending BaseCRUDService
// Handles business logic for UOM operations with standardized patterns

const BaseCRUDService = require('../../common/BaseCRUDService');
const { QUERIES } = require('../../config/constants');
const { logger } = require('../../utils/logger');

/**
 * UOM Service extending base CRUD functionality
 */
class UomService extends BaseCRUDService {
  constructor() {
    super('UOM', QUERIES.UOM);
  }

  /**
   * Prepare parameters for UOM insertion
   * @param {string} id - Generated ID
   * @param {Object} data - UOM data
   * @param {string} tenantId - Tenant ID
   * @param {string} userEmail - User email
   * @returns {Array} Parameters for INSERT query
   */
  prepareInsertParams(id, data, tenantId, userEmail) {
    return [
      id,
      tenantId,
      data.UnitName,
      data.IsPrimary !== undefined ? data.IsPrimary : false,
      data.Active !== undefined ? data.Active : true,
      userEmail,
      userEmail,
    ];
  }

  /**
   * Prepare parameters for UOM update
   * @param {Object} data - New data
   * @param {Object} existing - Existing record
   * @param {string} userEmail - User email
   * @param {string} id - Record ID
   * @param {string} tenantId - Tenant ID
   * @returns {Array} Parameters for UPDATE query
   */
  prepareUpdateParams(data, existing, userEmail, id, tenantId) {
    const updatedUnitName =
      data.UnitName !== undefined ? data.UnitName : existing.UnitName;
    const updatedIsPrimary =
      data.IsPrimary !== undefined ? data.IsPrimary : existing.IsPrimary;
    const updatedActive =
      data.Active !== undefined ? data.Active : existing.Active;

    return [
      updatedUnitName,
      updatedIsPrimary,
      updatedActive,
      userEmail,
      id,
      tenantId,
    ];
  }

  /**
   * Get all UOMs for a tenant with pagination.
   * @param {string} tenantId - Tenant ID
   * @param {number} page - Page number
   * @param {number} limit - Items per page
   * @returns {Promise<Object>} Paginated results
   */
  async getAllUom(tenantId, page = 1, limit = 10) {
    logger.info('UomService.getAllUom called', {
      tenantId,
      page,
      limit,
    });
    return await this.getAll(tenantId, page, limit);
  }

  /**
   * Get UOM by ID.
   * @param {string} id - UOM ID
   * @param {string} tenantId - Tenant ID
   * @returns {Promise<Object>} UOM object
   */
  async getUomById(id, tenantId) {
    logger.info('UomService.getUomById called', { id, tenantId });
    return await this.getById(id, tenantId);
  }

  /**
   * Create new UOM.
   * @param {Object} uomData - UOM data
   * @param {string} tenantId - Tenant ID
   * @param {string} userEmail - User email
   * @returns {Promise<Object>} Created UOM
   */
  async createUom(uomData, tenantId, userEmail) {
    logger.info('UomService.createUom called', { tenantId, userEmail });
    return await this.create(uomData, tenantId, userEmail);
  }

  /**
   * Update existing UOM.
   * @param {string} id - UOM ID
   * @param {Object} updateData - Updated data
   * @param {string} tenantId - Tenant ID
   * @param {string} userEmail - User email
   * @returns {Promise<Object>} Updated UOM
   */
  async updateUom(id, updateData, tenantId, userEmail) {
    logger.info('UomService.updateUom called', {
      id,
      tenantId,
      userEmail,
    });
    return await this.update(id, updateData, tenantId, userEmail);
  }

  /**
   * Delete UOM.
   * @param {string} id - UOM ID
   * @param {string} tenantId - Tenant ID
   * @returns {Promise<void>}
   */
  async deleteUom(id, tenantId) {
    logger.info('UomService.deleteUom called', { id, tenantId });
    return await this.delete(id, tenantId);
  }
}

// Create singleton instance
const uomService = new UomService();

module.exports = {
  getAllUom: (tenantId, page, limit) =>
    uomService.getAllUom(tenantId, page, limit),
  getUomById: (id, tenantId) => uomService.getUomById(id, tenantId),
  createUom: (data, tenantId, userEmail) =>
    uomService.createUom(data, tenantId, userEmail),
  updateUom: (id, data, tenantId, userEmail) =>
    uomService.updateUom(id, data, tenantId, userEmail),
  deleteUom: (id, tenantId) => uomService.deleteUom(id, tenantId),
};
