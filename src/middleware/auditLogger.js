// src/middleware/auditLogger.js
// Middleware for logging user actions to audit logs.
// Provides functions to log actions and retrieve audit logs with filters.

const db = require('../config/db')
const { logger } = require('../utils/logger')
const { QUERIES, STATUSES, DEFAULTS } = require('../config/constants')

/**
 * Middleware to log user actions after authentication.
 * @returns {Function} Express middleware function.
 */
const auditLog = () => {
  return async (req, res, next) => {
    const { email, tid } = req.user
    const action = `${req.method} ${req.path}`

    try {
      await db.execute(QUERIES.AUDIT_LOGS_MIDDLEWARE, [
        tid,
        email,
        action,
        STATUSES.SUCCESS,
      ])
    } catch (err) {
      logger.error('Audit Logging Failed', err)
    }
    next()
  }
}

/**
 * Retrieves audit logs from the database with optional filters.
 * @param {Object} filters - Optional filters for the query.
 * @param {string[]} filters.tenantIds - Array of tenant IDs to filter by.
 * @param {string} filters.userEmail - Filter by user email.
 * @param {number} filters.limit - Limit the number of results (default 100).
 * @param {number} filters.offset - Offset for pagination (default 0).
 * @returns {Promise<Array>} Array of audit log records.
 */
const getAuditLogs = async (filters = {}) => {
  const connection = await db.getConnection()
  try {
    const {
      tenantIds,
      userEmail,
      limit = DEFAULTS.AUDIT_LIMIT,
      offset = DEFAULTS.AUDIT_OFFSET,
      isAdmin = isAdmin,
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

    if (!isAdmin && userEmail) {
      query += ' AND user_email = ?'
      params.push(userEmail)
    }

    query += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?'
    params.push(limit, offset)

    // console.log('Final Audit Logs Query:', query)

    const [rows] = await connection.query(query, params)
    return rows
  } catch (err) {
    logger.error('Failed to retrieve audit logs', err)
    throw err
  } finally {
    connection.release()
  }
}

module.exports = {
  auditLog,
  getAuditLogs,
}
