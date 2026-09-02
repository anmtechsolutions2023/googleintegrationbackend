// src/middleware/auditLogger.js
// Middleware for logging user actions to audit_logs after the response is sent.
// Uses res.on('finish') so the actual HTTP status code is known before writing.

const db = require('../config/db');
const config = require('../config/config');
const { logger } = require('../utils/logger');
const { QUERIES, STATUSES, AUDIT_CATEGORIES } = require('../config/constants');

const getIp = (req) =>
  req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
  req.headers['x-real-ip'] ||
  req.headers['cf-connecting-ip'] ||
  req.socket?.remoteAddress ||
  config.AUDIT.DEFAULT_IP;

const writeAuditLog = async (tid, email, action, status, ip, level, category) => {
  await db.execute(QUERIES.AUDIT_LOGS.INSERT_MIDDLEWARE, [
    tid || null, email, action, status, ip, level, category, null, null,
  ]);
};

/**
 * Middleware to log user actions after the response is sent.
 * @param {string} category    - Audit category (from AUDIT_CATEGORIES).
 * @param {string} defaultLevel - Default log level when the response is 2xx.
 * @param {string} [actionLabel] - Human-readable action label. Falls back to
 *                                 "METHOD /path" when omitted.
 * @returns {Function} Express middleware.
 */
const auditLog = (category = AUDIT_CATEGORIES.GENERAL, defaultLevel = 'INFO', actionLabel = null) => {
  return (req, res, next) => {
    const ip = getIp(req);

    res.on('finish', async () => {
      if (!req.user) return;

      const { email, tid } = req.user;
      const action = actionLabel || `${req.method} ${req.path}`;
      const httpStatus = res.statusCode;

      const level =
        httpStatus >= 500 ? 'ERROR' :
        httpStatus >= 400 ? 'WARN'  :
        defaultLevel;

      const status = httpStatus >= 400 ? STATUSES.FAILED : STATUSES.SUCCESS;

      try {
        await writeAuditLog(tid, email, action, status, ip, level, category);
      } catch (err) {
        logger.error('Audit logging failed', { err: err.message });
      }
    });

    next();
  };
};

/**
 * Middleware factory for generic CRUD module routes.
 * Derives a human-readable action label from the HTTP method and whether
 * the route targets a single record (path !== '/') or the collection.
 *
 * @param {string} moduleName  - Display name of the module, e.g. "Category".
 * @param {string} category    - Audit category (defaults to MASTER_DATA).
 * @param {string} defaultLevel - Default log level for 2xx responses.
 * @returns {Function} Express middleware.
 */
const auditLogCrud = (moduleName, category = AUDIT_CATEGORIES.MASTER_DATA, defaultLevel = 'INFO') => {
  return (req, res, next) => {
    const ip = getIp(req);

    res.on('finish', async () => {
      if (!req.user) return;

      const { email, tid } = req.user;
      const isById = req.path !== '/';
      const methodLabelMap = {
        GET:    isById ? `Viewed ${moduleName} details` : `Viewed ${moduleName} list`,
        POST:   `Created ${moduleName}`,
        PUT:    `Updated ${moduleName}`,
        PATCH:  `Updated ${moduleName}`,
        DELETE: `Deleted ${moduleName}`,
      };
      const action = methodLabelMap[req.method] || `${req.method} ${req.path}`;
      const httpStatus = res.statusCode;

      const level =
        httpStatus >= 500 ? 'ERROR' :
        httpStatus >= 400 ? 'WARN'  :
        defaultLevel;

      const status = httpStatus >= 400 ? STATUSES.FAILED : STATUSES.SUCCESS;

      try {
        await writeAuditLog(tid, email, action, status, ip, level, category);
      } catch (err) {
        logger.error('Audit logging failed', { err: err.message });
      }
    });

    next();
  };
};

module.exports = { auditLog, auditLogCrud };
