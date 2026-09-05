// src/common/BaseCRUDService.js
// Base class for CRUD operations to reduce code duplication
// Provides standard CRUD methods that can be extended by specific services

const { v4: uuidv4 } = require('uuid')
const { logger } = require('../utils/logger')
const { withConnection } = require('../utils/dbHelper')
const {
  calculatePagination,
  getPaginationMetadata,
  buildPaginatedQuery,
  extractCount,
} = require('../utils/paginationHelper')
const MESSAGES = require('../config/messages')
const { HttpError } = require('../middleware/errorHandler')

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
    this.entityName = entityName
    this.queries = queries
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
    })

    // Validate tenantId
    if (!tenantId) {
      logger.error(`${this.entityName}.getAll called with undefined tenantId`)
      throw new HttpError(
        'Tenant ID is required',
        MESSAGES.HTTP_STATUS.BAD_REQUEST,
      )
    }

    const { pageNum, limitNum, offset } = calculatePagination(page, limit)

    return await withConnection(async (connection) => {
      // Get total count
      logger.info(`Executing COUNT query`, {
        query: this.queries.COUNT,
        tenantId,
      })
      const [countResult] = await connection.execute(this.queries.COUNT, [
        tenantId,
      ])
      const total = extractCount(countResult)

      // Determine which query to use based on expand parameter
      const selectQuery =
        expand && this.queries.SELECT_ALL_WITH_DETAILS
          ? this.queries.SELECT_ALL_WITH_DETAILS
          : this.queries.SELECT_ALL

      // Get paginated data using safe string interpolation (MySQL doesn't support LIMIT/OFFSET placeholders)
      const baseQueryWithTenant = selectQuery.replace('?', `'${tenantId}'`)
      const paginatedQuery = buildPaginatedQuery(
        baseQueryWithTenant,
        limitNum,
        offset,
      )

      logger.info(`Executing paginated query:`, {
        query: paginatedQuery,
        expand,
      })

      const [rows] = await connection.query(paginatedQuery)

      const pagination = getPaginationMetadata(total, pageNum, limitNum)

      logger.info(`${this.entityName}s fetched successfully`, {
        tenantId,
        count: rows.length,
        total,
        page: pageNum,
        expand,
      })

      return {
        data: rows,
        pagination,
      }
    })
  }

  /**
   * Get a single record by ID.
   * @param {string} id - Record ID
   * @param {string} tenantId - Tenant ID
   * @param {boolean} expand - Whether to include related entity details (default: false)
   * @returns {Promise<Object>} Record object
   */
  async getById(id, tenantId, expand = false) {
    logger.info(`Fetching ${this.entityName} by ID`, { id, tenantId, expand })

    return await withConnection(async (connection) => {
      // Determine which query to use based on expand parameter
      const selectQuery =
        expand && this.queries.SELECT_BY_ID_WITH_DETAILS
          ? this.queries.SELECT_BY_ID_WITH_DETAILS
          : this.queries.SELECT_BY_ID

      const [rows] = await connection.execute(selectQuery, [id, tenantId])

      if (rows.length === 0) {
        logger.warn(`${this.entityName} not found`, { id, tenantId })
        throw new HttpError(
          `${this.entityName} not found`,
          MESSAGES.HTTP_STATUS.NOT_FOUND,
        )
      }

      logger.info(`${this.entityName} fetched successfully`, {
        id,
        tenantId,
        expand,
      })
      return rows[0]
    })
  }

  /**
   * Get a single record on a caller-supplied connection.
   *
   * Use this instead of `getById` for any read that happens INSIDE a
   * transaction. `getById` takes its own connection from the pool, which sits
   * outside the open transaction and therefore cannot see uncommitted writes —
   * a read-after-write in the same transaction would silently return the old
   * row, or a 404 for a row that was just inserted.
   *
   * @param {Object} connection - Active transaction connection
   * @param {string} id - Record ID
   * @param {string} tenantId - Tenant ID
   * @param {boolean} expand - Whether to include related entity details
   * @returns {Promise<Object>} Record object
   */
  async getByIdTx(connection, id, tenantId, expand = false) {
    const selectQuery =
      expand && this.queries.SELECT_BY_ID_WITH_DETAILS
        ? this.queries.SELECT_BY_ID_WITH_DETAILS
        : this.queries.SELECT_BY_ID

    const [rows] = await connection.execute(selectQuery, [id, tenantId])

    if (rows.length === 0) {
      logger.warn(`${this.entityName} not found`, { id, tenantId })
      throw new HttpError(
        `${this.entityName} not found`,
        MESSAGES.HTTP_STATUS.NOT_FOUND,
      )
    }
    return rows[0]
  }

  /**
   * Create a new record.
   * @param {Object} data - Record data
   * @param {string} tenantId - Tenant ID
   * @param {string} userPhone - User email
   * @returns {Promise<Object>} Created record
   */
  async create(data, tenantId, userPhone) {
    logger.info(`Creating ${this.entityName}`, { tenantId, userPhone })

    return await withConnection(async (connection) =>
      this.createTx(connection, data, tenantId, userPhone),
    )
  }

  /**
   * Insert a new record on a caller-supplied connection WITHOUT managing the
   * connection or transaction. The caller owns commit/rollback — use this to
   * compose several inserts across modules inside a single transaction
   * (e.g. the master-data bootstrap orchestrator).
   * @param {Object} connection - Active DB connection (typically inside withTransaction)
   * @param {Object} data - Record data
   * @param {string} tenantId - Tenant ID
   * @param {string} userPhone - User email
   * @returns {Promise<Object>} Created record ({ id, ...data })
   */
  async createTx(connection, data, tenantId, userPhone) {
    const id = uuidv4()

    // Prepare insert parameters - this should be overridden in child classes
    const params = this.prepareInsertParams(id, data, tenantId, userPhone)

    // Debug logging to catch undefined parameters
    logger.info(`${this.entityName} INSERT params:`, {
      params,
      query: this.queries.INSERT,
    })

    // Check for undefined parameters
    if (params.some((param) => param === undefined)) {
      logger.error(`Undefined parameters detected:`, { params })
      throw new HttpError(
        `Invalid parameters: contains undefined values`,
        MESSAGES.HTTP_STATUS.BAD_REQUEST,
      )
    }

    await connection.execute(this.queries.INSERT, params)

    logger.info(`${this.entityName} created successfully`, { id, tenantId })
    return {
      id,
      ...data,
    }
  }

  /**
   * Update an existing record.
   * @param {string} id - Record ID
   * @param {Object} data - Updated data
   * @param {string} tenantId - Tenant ID
   * @param {string} userPhone - User email
   * @returns {Promise<Object>} Updated record
   */
  async update(id, data, tenantId, userPhone) {
    logger.info(`Updating ${this.entityName}`, { id, tenantId, userPhone })

    return await withConnection(async (connection) => {
      // First check if record exists
      const existing = await this.getById(id, tenantId)

      // Prepare update parameters - this should be overridden in child classes
      const params = this.prepareUpdateParams(
        data,
        existing,
        userPhone,
        id,
        tenantId,
      )
      // Log query and params for debugging update persistence issues
      try {
        logger.debug('Executing UPDATE', { sql: this.queries.UPDATE, params })
      } catch (e) {
        // swallow logging errors
      }

      // Log update query and params for debugging
      logger.info(`${this.entityName} UPDATE params:`, {
        params,
        query: this.queries.UPDATE,
      })

      // Sanitize undefined values to null so mysql2 doesn't throw
      const sanitizedParams = params.map((p) => (p === undefined ? null : p))

      await connection.execute(this.queries.UPDATE, sanitizedParams)

      logger.info(`${this.entityName} updated successfully`, { id, tenantId })

      // Return updated record
      return await this.getById(id, tenantId)
    })
  }

  /**
   * Update a record on a caller-supplied connection WITHOUT managing the
   * connection or transaction — the mirror of createTx above.
   *
   * Exists so an update can be composed into a transaction that spans several
   * modules, which is what a bulk import does: re-pricing an item means writing
   * a new cost info and re-pointing the item at it, and half of that pair
   * committing would leave a price nobody chose.
   *
   * update() above is deliberately untouched and does not delegate here: it is
   * on the hot path of every CRUD screen in the app, and this method exists to
   * add a capability, not to refactor one.
   *
   * @param {Object} connection - Active DB connection (typically inside withTransaction)
   * @param {string} id - Record ID
   * @param {Object} data - Fields to change
   * @param {string} tenantId - Tenant ID
   * @param {string} userPhone - User email
   * @returns {Promise<Object>} { id, ...data }
   */
  async updateTx(connection, id, data, tenantId, userPhone) {
    const [existingRows] = await connection.execute(this.queries.SELECT_BY_ID, [id, tenantId])
    if (!existingRows || existingRows.length === 0) {
      throw new HttpError(
        `${this.entityName} not found`,
        MESSAGES.HTTP_STATUS.NOT_FOUND,
      )
    }

    const params = this.prepareUpdateParams(
      data,
      existingRows[0],
      userPhone,
      id,
      tenantId,
    )
    // Same sanitising as update(): mysql2 throws on undefined, and a partial
    // payload legitimately leaves fields out.
    await connection.execute(
      this.queries.UPDATE,
      params.map((param) => (param === undefined ? null : param)),
    )

    logger.info(`${this.entityName} updated in transaction`, { id, tenantId })
    return { id, ...data }
  }

  /**
   * Delete a record.
   * @param {string} id - Record ID
   * @param {string} tenantId - Tenant ID
   * @returns {Promise<void>}
   */
  async delete(id, tenantId) {
    logger.info(`Deleting ${this.entityName}`, { id, tenantId })

    return await withConnection(async (connection) => {
      // First check if record exists
      await this.getById(id, tenantId)

      await connection.execute(this.queries.DELETE, [id, tenantId])

      logger.info(`${this.entityName} deleted successfully`, { id, tenantId })
    })
  }

  /**
   * Prepare parameters for insert query.
   * Override this in child classes to customize parameter mapping.
   * @param {string} id - Generated ID
   * @param {Object} data - Record data
   * @param {string} tenantId - Tenant ID
   * @param {string} userPhone - User email
   * @returns {Array} Parameters array for query
   */
  prepareInsertParams(id, data, tenantId, userPhone) {
    // Default implementation - override in child classes
    return [id, tenantId, userPhone]
  }

  /**
   * Prepare parameters for update query.
   * Override this in child classes to customize parameter mapping.
   * @param {Object} data - New data
   * @param {Object} existing - Existing record
   * @param {string} userPhone - User email
   * @param {string} id - Record ID
   * @param {string} tenantId - Tenant ID
   * @returns {Array} Parameters array for query
   */
  prepareUpdateParams(data, existing, userPhone, id, tenantId) {
    // Default implementation - override in child classes
    return [userPhone, id, tenantId]
  }
}

module.exports = BaseCRUDService
