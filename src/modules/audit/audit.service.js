// src/modules/audit/audit.service.js
// Service layer for audit log operations.

const db = require('../../config/db');
const { logger } = require('../../utils/logger');
const { QUERIES, DEFAULTS } = require('../../config/constants');
const MESSAGES = require('../../config/messages');
const { HttpError } = require('../../middleware/errorHandler');

/**
 * Retrieves audit logs with full filter + pagination support.
 *
 * @param {Object} filters
 * @param {string}  [filters.tenantId]   - Filter to a single tenant (super-admin only).
 * @param {string}  [filters.userPhone]  - Filter by exact user email.
 * @param {string}  [filters.category]   - Filter by AUDIT_CATEGORIES value.
 * @param {string}  [filters.logLevel]   - Filter by log level (DEBUG|INFO|WARN|ERROR).
 * @param {string}  [filters.startDate]  - ISO date string lower bound (inclusive).
 * @param {string}  [filters.endDate]    - ISO date string upper bound (inclusive).
 * @param {number}  [filters.page]       - 1-based page number.
 * @param {number}  [filters.limit]      - Records per page.
 * @returns {Promise<{rows: Array, total: number, page: number, limit: number, totalPages: number}>}
 */
const getAuditLogs = async (filters = {}) => {
  logger.info('Retrieving audit logs', { filters });

  const {
    tenantId,
    userPhone,
    category,
    logLevel,
    startDate,
    endDate,
    page  = 1,
    limit = DEFAULTS.AUDIT_LIMIT,
  } = filters;

  const safePage  = Math.max(1, parseInt(page, 10)  || 1);
  const safeLimit = Math.min(parseInt(limit, 10) || DEFAULTS.AUDIT_LIMIT, DEFAULTS.AUDIT_MAX_LIMIT);
  const offset    = (safePage - 1) * safeLimit;

  const conditions = [];
  const params     = [];

  if (tenantId) {
    conditions.push('tenant_id = ?');
    params.push(tenantId);
  }
  if (userPhone) {
    conditions.push('user_phone = ?');
    params.push(userPhone);
  }
  if (category) {
    conditions.push('category = ?');
    params.push(category);
  }
  if (logLevel) {
    conditions.push('log_level = ?');
    params.push(logLevel);
  }
  if (startDate) {
    conditions.push('timestamp >= ?');
    params.push(startDate);
  }
  if (endDate) {
    conditions.push('timestamp <= ?');
    params.push(endDate);
  }

  const whereClause = conditions.length
    ? ` AND ${conditions.join(' AND ')}`
    : '';

  const dataQuery  = `${QUERIES.AUDIT_LOGS.SELECT}${whereClause} ORDER BY timestamp DESC LIMIT ? OFFSET ?`;
  const countQuery = `${QUERIES.AUDIT_LOGS.COUNT}${whereClause}`;

  const connection = await db.getConnection();
  try {
    const [[countRow], [rows]] = await Promise.all([
      connection.query(countQuery, params),
      connection.query(dataQuery, [...params, safeLimit, offset]),
    ]);

    const total      = countRow[0]?.total ?? 0;
    const totalPages = Math.ceil(total / safeLimit);

    logger.info('Audit logs retrieved', { count: rows.length, total });
    return { rows, total, page: safePage, limit: safeLimit, totalPages };
  } catch (err) {
    logger.error('Get audit logs error', err);
    throw new HttpError(MESSAGES.ERROR.AUDIT_LOGS_FAILED, 500);
  } finally {
    connection.release();
  }
};

module.exports = { getAuditLogs };
