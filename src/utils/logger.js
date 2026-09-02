// src/utils/logger.js
// Centralized logging using Winston for better production logging

const winston = require('winston');
const db = require('../config/db');
const config = require('../config/config');
const { LOG_LEVEL } = require('../config/envConfig');
const { QUERIES, AUDIT_CATEGORIES } = require('../config/constants');

const logger = winston.createLogger({
  level: LOG_LEVEL,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.simple(),
    }),
    // new winston.transports.File({ filename: 'error.log', level: 'error' }),
  ],
});

/**
 * Captures a named business-event audit log entry.
 * Use this for semantic events (login, approve, reject) where the action name
 * and resource ID matter more than the raw HTTP path.
 *
 * @param {Object} req         - Express request (used for IP extraction).
 * @param {string|null} tenantId
 * @param {string} email
 * @param {string} action      - Named action constant (e.g. 'ONBOARDING_APPROVED').
 * @param {string} status      - Outcome status (e.g. 'SUCCESS', 'FAILED').
 * @param {string} [category]  - AUDIT_CATEGORIES value (default: AUTH).
 * @param {string} [level]     - Log level: DEBUG | INFO | WARN | ERROR (default: INFO).
 * @param {string|null} [resourceId] - ID of the primary entity acted upon.
 */
const captureAudit = async (
  req,
  tenantId,
  email,
  action,
  status,
  category = AUDIT_CATEGORIES.AUTH,
  level = 'INFO',
  resourceId = null,
  // Free-text context the id cannot carry — e.g. whose tenancy was deleted,
  // read before the rows that would answer it were removed.
  details = null
) => {
  const ip =
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.headers['x-real-ip'] ||
    req.headers['cf-connecting-ip'] ||
    req.socket?.remoteAddress ||
    config.AUDIT.DEFAULT_IP;

  try {
    await db.execute(QUERIES.AUDIT_LOGS.INSERT, [
      tenantId || null,
      email,
      action,
      status,
      ip,
      level,
      category,
      resourceId,
      details || null,
    ]);
    logger.info('Audit captured', { tenantId, email, action, status, category, level });
  } catch (err) {
    logger.error('Critical audit log failure', { err: err.message });
  }
};

module.exports = { logger, captureAudit };
