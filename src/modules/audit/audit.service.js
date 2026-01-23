// src/modules/audit/audit.service.js
// Service layer for audit log operations.
// Handles audit log retrieval and filtering.

const db = require('../../config/db');
const config = require('../../config/config');
const { logger } = require('../../utils/logger');
const { QUERIES } = require('../../config/constants');
const MESSAGES = require('../../config/messages');
const { HttpError } = require('../../middleware/errorHandler');

/**
 * Retrieves audit logs with filters.
 * @param {Object} filters - Filters for the query.
 * @returns {Promise<Array>} Array of audit log records.
 */
const getAuditLogs = async (filters = {}) => {
  logger.info('Retrieving audit logs', { filters });

  const connection = await db.getConnection();
  try {
    const {
      tenantIds,
      userEmail,
      limit = config.AUDIT.DEFAULT_LIMIT,
      offset = config.AUDIT.DEFAULT_OFFSET,
    } = filters;

    let query = QUERIES.AUDIT_LOGS_SELECT;
    const params = [];

    if (tenantIds && tenantIds.length > 0) {
      if (tenantIds.length === 1) {
        query += ' AND tenant_id = ?';
      } else {
        query += ` AND tenant_id IN (${tenantIds.map(() => '?').join(', ')})`;
      }
      params.push(...tenantIds);
    }

    if (userEmail) {
      query += ' AND user_email = ?';
      params.push(userEmail);
    }

    query += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    logger.debug('Executing audit logs query', { query, params });
    const [rows] = await connection.query(query, params);

    logger.info('Audit logs retrieved successfully', { count: rows.length });
    return rows;
  } catch (err) {
    logger.error('Get audit logs error', err);
    throw new HttpError(MESSAGES.ERROR.AUDIT_LOGS_FAILED, 500);
  } finally {
    connection.release();
  }
};

/**
 * Retrieves user tenants for audit access.
 * @param {string} userEmail - User email.
 * @returns {Promise<Array>} Array of tenant rows.
 */
const getUserTenants = async (userEmail) => {
  const connection = await db.getConnection();
  try {
    const [rows] = await connection.execute(QUERIES.USER_TENANTS_SELECT, [
      userEmail,
    ]);
    return rows;
  } finally {
    connection.release();
  }
};

module.exports = {
  getAuditLogs,
  getUserTenants,
};
