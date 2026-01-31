// src/common/BaseCRUDService.js
// Base class for CRUD operations to reduce code duplication
// Provides standard CRUD methods that can be extended by specific services

const { v4: uuidv4 } = require('uuid');
const { logger } = require('../utils/logger');
const { withConnection } = require('../utils/dbHelper');
const {
  calculatePagination,
  getPaginationMetadata,
  buildPaginatedQuery,
  extractCount,
} = require('../utils/paginationHelper');
const MESSAGES = require('../config/messages');
const { HttpError } = require('../middleware/errorHandler');

/**
 * Base CRUD service class that provides standard database operations.
 * Extend this class for specific entity services.
 */
class BaseCRUDService {
  /**
   * Constructor for base CRUD service.
   * @param {string} entityName - Name of the entity (for logging and errors)
   * @param {Object} queries - Object containing SQL queries
   * @param {string} queries.SELECT_ALL - Query to get all records
   * @param {string} queries.SELECT_ALL_PAGINATED - Query for paginated results (optional)
   * @param {string} queries.COUNT - Query to count total records
   * @param {string} queries.SELECT_BY_ID - Query to get record by ID
   * @param {string} queries.INSERT - Query to insert new record
   * @param {string} queries.UPDATE - Query to update existing record
   * @param {string} queries.DELETE - Query to delete record
   */
  constructor(entityName, queries) {
    this.entityName = entityName;
    this.queries = queries;
  }

  /**
   * Get all records for a tenant with pagination.
   * @param {string} tenantId - Tenant ID
   * @param {number} page - Page number
   * @param {number} limit - Items per page
   * @param {boolean} expand - Whether to include related entity details (default: false)
   * @returns {Promise<Object>} Paginated results
   */
  async getAll(tenantId, page = 1, limit = 10, expand = false) {
    logger.info(`Fetching all ${this.entityName}s`, {
      tenantId,
      page,
      limit,
      expand,
    });

    // Validate tenantId
    if (!tenantId) {
      logger.error(`${this.entityName}.getAll called with undefined tenantId`);
      throw new HttpError(
        'Tenant ID is required',
        MESSAGES.HTTP_STATUS.BAD_REQUEST
      );
    }

    const { pageNum, limitNum, offset } = calculatePagination(page, limit);

    return await withConnection(async (connection) => {
      // Get total count
      logger.info(`Executing COUNT query`, {
        query: this.queries.COUNT,
        tenantId,
      });
      const [countResult] = await connection.execute(this.queries.COUNT, [
        tenantId,
      ]);
      const total = extractCount(countResult);

      // Determine which query to use based on expand parameter
      const selectQuery =
        expand && this.queries.SELECT_ALL_WITH_DETAILS
          ? this.queries.SELECT_ALL_WITH_DETAILS
          : this.queries.SELECT_ALL;

      // Get paginated data using safe string interpolation (MySQL doesn't support LIMIT/OFFSET placeholders)
      const baseQueryWithTenant = selectQuery.replace('?', `'${tenantId}'`);
      const paginatedQuery = buildPaginatedQuery(
        baseQueryWithTenant,
        limitNum,
        offset
      );

      logger.info(`Executing paginated query:`, {
        query: paginatedQuery,
        expand,
      });

      const [rows] = await connection.query(paginatedQuery);

      const pagination = getPaginationMetadata(total, pageNum, limitNum);

      logger.info(`${this.entityName}s fetched successfully`, {
        tenantId,
        count: rows.length,
        total,
        page: pageNum,
        expand,
      });

      return {
        data: rows,
        pagination,
      };
    });
  }

  /**
   * Get a single record by ID.
   * @param {string} id - Record ID
   * @param {string} tenantId - Tenant ID
   * @param {boolean} expand - Whether to include related entity details (default: false)
   * @returns {Promise<Object>} Record object
   */
  async getById(id, tenantId, expand = false) {
    logger.info(`Fetching ${this.entityName} by ID`, { id, tenantId, expand });

    return await withConnection(async (connection) => {
      // Determine which query to use based on expand parameter
      const selectQuery =
        expand && this.queries.SELECT_BY_ID_WITH_DETAILS
          ? this.queries.SELECT_BY_ID_WITH_DETAILS
          : this.queries.SELECT_BY_ID;

      const [rows] = await connection.execute(selectQuery, [id, tenantId]);

      if (rows.length === 0) {
        logger.warn(`${this.entityName} not found`, { id, tenantId });
        throw new HttpError(
          `${this.entityName} not found`,
          MESSAGES.HTTP_STATUS.NOT_FOUND
        );
      }

      logger.info(`${this.entityName} fetched successfully`, {
        id,
        tenantId,
        expand,
      });
      return rows[0];
    });
  }

  /**
   * Create a new record.
   * @param {Object} data - Record data
   * @param {string} tenantId - Tenant ID
   * @param {string} userEmail - User email
   * @returns {Promise<Object>} Created record
   */
  async create(data, tenantId, userEmail) {
    logger.info(`Creating ${this.entityName}`, { tenantId, userEmail });

    return await withConnection(async (connection) => {
      const id = uuidv4();

      // Prepare insert parameters - this should be overridden in child classes
      const params = this.prepareInsertParams(id, data, tenantId, userEmail);

      // Debug logging to catch undefined parameters
      logger.info(`${this.entityName} INSERT params:`, {
        params,
        query: this.queries.INSERT,
      });

      // Check for undefined parameters
      if (params.some((param) => param === undefined)) {
        logger.error(`Undefined parameters detected:`, { params });
        throw new HttpError(
          `Invalid parameters: contains undefined values`,
          MESSAGES.HTTP_STATUS.BAD_REQUEST
        );
      }

      await connection.execute(this.queries.INSERT, params);

      logger.info(`${this.entityName} created successfully`, { id, tenantId });
      return {
        id,
        ...data,
      };
    });
  }

  /**
   * Update an existing record.
   * @param {string} id - Record ID
   * @param {Object} data - Updated data
   * @param {string} tenantId - Tenant ID
   * @param {string} userEmail - User email
   * @returns {Promise<Object>} Updated record
   */
  async update(id, data, tenantId, userEmail) {
    logger.info(`Updating ${this.entityName}`, { id, tenantId, userEmail });

    return await withConnection(async (connection) => {
      // First check if record exists
      const existing = await this.getById(id, tenantId);

      // Prepare update parameters - this should be overridden in child classes
      const params = this.prepareUpdateParams(
        data,
        existing,
        userEmail,
        id,
        tenantId
      );

      await connection.execute(this.queries.UPDATE, params);

      logger.info(`${this.entityName} updated successfully`, { id, tenantId });

      // Return updated record
      return await this.getById(id, tenantId);
    });
  }

  /**
   * Delete a record.
   * @param {string} id - Record ID
   * @param {string} tenantId - Tenant ID
   * @returns {Promise<void>}
   */
  async delete(id, tenantId) {
    logger.info(`Deleting ${this.entityName}`, { id, tenantId });

    return await withConnection(async (connection) => {
      // First check if record exists
      await this.getById(id, tenantId);

      await connection.execute(this.queries.DELETE, [id, tenantId]);

      logger.info(`${this.entityName} deleted successfully`, { id, tenantId });
    });
  }

  /**
   * Prepare parameters for insert query.
   * Override this in child classes to customize parameter mapping.
   * @param {string} id - Generated ID
   * @param {Object} data - Record data
   * @param {string} tenantId - Tenant ID
   * @param {string} userEmail - User email
   * @returns {Array} Parameters array for query
   */
  prepareInsertParams(id, data, tenantId, userEmail) {
    // Default implementation - override in child classes
    return [id, tenantId, userEmail];
  }

  /**
   * Prepare parameters for update query.
   * Override this in child classes to customize parameter mapping.
   * @param {Object} data - New data
   * @param {Object} existing - Existing record
   * @param {string} userEmail - User email
   * @param {string} id - Record ID
   * @param {string} tenantId - Tenant ID
   * @returns {Array} Parameters array for query
   */
  prepareUpdateParams(data, existing, userEmail, id, tenantId) {
    // Default implementation - override in child classes
    return [userEmail, id, tenantId];
  }
}

module.exports = BaseCRUDService;
