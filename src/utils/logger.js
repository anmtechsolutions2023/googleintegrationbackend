// src/utils/logger.js
// Centralized logging using Winston for better production logging

const winston = require('winston')
const db = require('../config/db')
const { QUERIES } = require('../config/constants')

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.simple(),
    }),
    // Add file transport if needed
    // new winston.transports.File({ filename: 'error.log', level: 'error' }),
  ],
})

/**
 * Captures audit logs to database and logs to Winston.
 * @param {Object} req - Express request object.
 * @param {string|null} tenantId - Tenant ID.
 * @param {string} email - User email.
 * @param {string} action - Action performed.
 * @param {string} status - Status of the action.
 */
const captureAudit = async (req, tenantId, email, action, status) => {
  // Get IP: handle local vs proxy/load-balancer
  const ip =
    req.headers['x-forwarded-for']?.split(',')[0] ||
    req.socket.remoteAddress ||
    '0.0.0.0'

  try {
    await db.execute(QUERIES.AUDIT_LOGS_INSERT, [
      tenantId || null,
      email,
      action,
      status,
      ip,
    ])
    logger.info('Audit log captured', { tenantId, email, action, status, ip })
  } catch (err) {
    logger.error('Critical Audit Log Failure:', err)
  }
}

module.exports = { logger, captureAudit }
