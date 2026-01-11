// src/services/protected.service.js
// Service layer for protected routes business logic.
// Handles tenant switching, audit log retrieval, and other protected operations.

const db = require('../config/db')
const config = require('../config/config')
const { logger } = require('../utils/logger')
const { QUERIES } = require('../config/constants')
const { MESSAGES } = require('../config/messages')
const { HttpError } = require('../middleware/errorHandler')

/**
 * Switches tenant permissions for an authenticated user.
 * @param {Object} req - Express request object.
 * @param {string} userEmail - User email.
 * @param {string} targetTenantId - Target tenant ID.
 * @param {string} userName - User name.
 * @returns {Promise<Object>} New permissions object.
 */
const switchTenantPermissions = async (
  req,
  userEmail,
  targetTenantId,
  userName
) => {
  logger.info('Switching tenant permissions', { userEmail, targetTenantId })

  const connection = await db.getConnection()
  try {
    const [tenantRows] = await connection.execute(QUERIES.USER_TENANTS_SELECT, [
      userEmail,
    ])

    const targetTenant = tenantRows.find((t) => t.tenant_id === targetTenantId)
    if (!targetTenant) {
      logger.warn('Tenant access denied', { userEmail, targetTenantId })
      throw new HttpError(MESSAGES.ERROR.TENANT_ACCESS_DENIED, 403)
    }

    // Fetch permissions (reuse logic from auth.service if needed)
    const permissions = await getScopesForTenant(
      connection,
      targetTenantId,
      userEmail
    )
    if (targetTenant.is_admin) {
      permissions.push('TENANT:ADMIN')
    }

    logger.info('Tenant switch successful', { userEmail, targetTenantId })
    return {
      email: userEmail,
      name: userName,
      tenantId: targetTenantId,
      permissions,
      associatedTenants: tenantRows,
    }
  } catch (error) {
    logger.error('Switch tenant error', error)
    throw error
  } finally {
    connection.release()
  }
}

/**
 * Retrieves audit logs with filters.
 * @param {Object} filters - Filters for the query.
 * @returns {Promise<Array>} Array of audit log records.
 */
const getAuditLogs = async (filters = {}) => {
  logger.info('Retrieving audit logs', { filters })

  const connection = await db.getConnection()
  try {
    const {
      tenantIds,
      userEmail,
      limit = config.AUDIT.DEFAULT_LIMIT,
      offset = config.AUDIT.DEFAULT_OFFSET,
    } = filters

    let query = QUERIES.AUDIT_LOGS_SELECT
    const params = []

    if (tenantIds && tenantIds.length > 0) {
      if (tenantIds.length === 1) {
        query += ' AND tenant_id = ?'
      } else {
        query += ` AND tenant_id IN (${tenantIds.map(() => '?').join(', ')})`
      }
      params.push(...tenantIds)
    }

    if (userEmail) {
      query += ' AND user_email = ?'
      params.push(userEmail)
    }

    query += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?'
    params.push(limit, offset)

    logger.debug('Executing audit logs query', { query, params })
    const [rows] = await connection.query(query, params)

    logger.info('Audit logs retrieved successfully', { count: rows.length })
    return rows
  } catch (err) {
    logger.error('Failed to retrieve audit logs', err)
    throw new HttpError(MESSAGES.ERROR.AUDIT_LOGS_FAILED, 500)
  } finally {
    connection.release()
  }
}

/**
 * Helper: Fetches scopes for a tenant.
 * @param {Object} connection - DB connection.
 * @param {string} tenantId - Tenant ID.
 * @param {string} userEmail - User email.
 * @returns {Promise<string[]>} Array of scopes.
 */
const getScopesForTenant = async (connection, tenantId, userEmail) => {
  const [featureRows] = await connection.execute(QUERIES.PERMISSIONS_SELECT, [
    tenantId,
    userEmail,
  ])
  return featureRows.map((row) => `${row.feature_short_name}:${row.scope}`)
}

/**
 * Retrieves user tenants for audit access.
 * @param {string} userEmail - User email.
 * @returns {Promise<Array>} Array of tenant rows.
 */
// Simple in-memory cache for user tenants - see src/config/config.js for TTL
const cache = new Map()
const getUserTenants = async (userEmail) => {
  const cacheKey = `tenants_${userEmail}`
  const cached = cache.get(cacheKey)

  if (cached && Date.now() - cached.timestamp < config.DATABASE.CACHE_TTL) {
    logger.debug('Returning cached user tenants', { userEmail })
    return cached.data
  }

  logger.debug('Fetching user tenants from DB', { userEmail })
  const [rows] = await db.execute(QUERIES.USER_TENANTS_SELECT, [userEmail])

  cache.set(cacheKey, { data: rows, timestamp: Date.now() })
  return rows
}

module.exports = {
  switchTenantPermissions,
  getAuditLogs,
  getUserTenants,
}
