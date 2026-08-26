// src/modules/taxtype/taxtype.service.js
// Tax Type Service extending BaseCRUDService
// Handles business logic for tax type operations with standardized patterns

const BaseCRUDService = require('../../common/BaseCRUDService');
const { QUERIES } = require('../../config/constants');
const { logger } = require('../../utils/logger');

/**
 * Tax Type Service extending base CRUD functionality
 */
class TaxTypeService extends BaseCRUDService {
  constructor() {
    super('Tax Type', QUERIES.TAX_TYPES);
  }

  /**
   * Prepare parameters for tax type insertion
   * @param {string} id - Generated ID
   * @param {Object} data - Tax type data
   * @param {string} tenantId - Tenant ID
   * @param {string} userEmail - User email
   * @returns {Array} Parameters for INSERT query
   */
  prepareInsertParams(id, data, tenantId, userEmail) {
    return [
      id,
      tenantId,
      data.Name,
      data.Value,
      data.Active !== undefined ? data.Active : true,
      userEmail,
      userEmail,
    ];
  }

  /**
   * Prepare parameters for tax type update
   * @param {Object} data - New data
   * @param {Object} existing - Existing record
   * @param {string} userEmail - User email
   * @param {string} id - Record ID
   * @param {string} tenantId - Tenant ID
   * @returns {Array} Parameters for UPDATE query
   */
  prepareUpdateParams(data, existing, userEmail, id, tenantId) {
    const updatedName = data.Name !== undefined ? data.Name : existing.Name;
    const updatedValue = data.Value !== undefined ? data.Value : existing.Value;
    const updatedActive =
      data.Active !== undefined ? data.Active : existing.Active;

    return [updatedName, updatedValue, updatedActive, userEmail, id, tenantId];
  }

  /**
   * Get all tax types for a tenant with pagination.
   * @param {string} tenantId - Tenant ID
   * @param {number} page - Page number
   * @param {number} limit - Items per page
   * @returns {Promise<Object>} Paginated results
   */
  async getAllTaxTypes(tenantId, page = 1, limit = 10) {
    logger.info('TaxTypeService.getAllTaxTypes called', {
      tenantId,
      page,
      limit,
    });
    return await this.getAll(tenantId, page, limit);
  }

  /**
   * Get tax type by ID.
   * @param {string} id - Tax type ID
   * @param {string} tenantId - Tenant ID
   * @returns {Promise<Object>} Tax type object
   */
  async getTaxTypeById(id, tenantId) {
    logger.info('TaxTypeService.getTaxTypeById called', { id, tenantId });
    return await this.getById(id, tenantId);
  }

  /**
   * Create new tax type.
   * @param {Object} taxTypeData - Tax type data
   * @param {string} tenantId - Tenant ID
   * @param {string} userEmail - User email
   * @returns {Promise<Object>} Created tax type
   */
  async createTaxType(taxTypeData, tenantId, userEmail) {
    logger.info('TaxTypeService.createTaxType called', { tenantId, userEmail });
    return await this.create(taxTypeData, tenantId, userEmail);
  }

  /**
   * Update existing tax type.
   * @param {string} id - Tax type ID
   * @param {Object} updateData - Updated data
   * @param {string} tenantId - Tenant ID
   * @param {string} userEmail - User email
   * @returns {Promise<Object>} Updated tax type
   */
  async updateTaxType(id, updateData, tenantId, userEmail) {
    logger.info('TaxTypeService.updateTaxType called', {
      id,
      tenantId,
      userEmail,
    });
    return await this.update(id, updateData, tenantId, userEmail);
  }

  /**
   * Delete tax type.
   * @param {string} id - Tax type ID
   * @param {string} tenantId - Tenant ID
   * @returns {Promise<void>}
   */
  async deleteTaxType(id, tenantId) {
    logger.info('TaxTypeService.deleteTaxType called', { id, tenantId });
    return await this.delete(id, tenantId);
  }
}

// Create singleton instance
const taxTypeService = new TaxTypeService();

module.exports = {
  // Exposed for the bulk import, which creates a tax type and maps it into a
  // group inside one transaction with the item that needs it.
  createTx: (conn, data, tenantId, userEmail) =>
    taxTypeService.createTx(conn, data, tenantId, userEmail),
  getAllTaxTypes: (tenantId, page, limit) =>
    taxTypeService.getAllTaxTypes(tenantId, page, limit),
  getTaxTypeById: (id, tenantId) => taxTypeService.getTaxTypeById(id, tenantId),
  createTaxType: (data, tenantId, userEmail) =>
    taxTypeService.createTaxType(data, tenantId, userEmail),
  updateTaxType: (id, data, tenantId, userEmail) =>
    taxTypeService.updateTaxType(id, data, tenantId, userEmail),
  deleteTaxType: (id, tenantId) => taxTypeService.deleteTaxType(id, tenantId),
};
