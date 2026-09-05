// src/utils/logger.js
// Centralized logging using Winston for better production logging

const winston = require('winston');
const db = require('../config/db');
const config = require('../config/config');
const { LOG_LEVEL } = require('../config/envConfig');
const { QUERIES, AUDIT_CATEGORIES } = require('../config/constants');

// ── Redaction ───────────────────────────────────────────────────────────────
// The mobile number is the identity now, and 250-odd call sites pass it into
// log objects the way they used to pass an email address. An email in a log is
// untidy; a phone number in a log is personal data sitting in plaintext in
// whatever aggregator the logs end up in.
//
// Doing this in the format pipeline rather than at each call site is the only
// version that stays true: a new logger.info added next month is covered
// automatically, and there is no rule for anyone to remember. See
// WHATSAPP_IDENTITY_MIGRATION.md §9.6.
const E164 = /\+\d{8,15}/g;

const maskNumbers = (value, depth = 0) => {
  if (depth > 6) return value;
  if (typeof value === 'string') {
    return value.replace(E164, (m) => `${m.slice(0, 5)}\u2022\u2022\u2022\u2022${m.slice(-4)}`);
  }
  if (Array.isArray(value)) return value.map((v) => maskNumbers(v, depth + 1));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = maskNumbers(v, depth + 1);
    return out;
  }
  return value;
};

// MUTATES info in place. Rebuilding it — `return maskNumbers(info)` — looks
// equivalent and is not: winston carries the level and the rendered message on
// SYMBOL keys (Symbol.for('level'), Symbol.for('message')), and Object.entries
// does not copy symbols. A rebuilt info object loses them, the transport has
// nothing to print, and every log line in the application silently disappears.
// That is exactly what happened here, and it hid a 500 for an afternoon.
const redactPhones = winston.format((info) => {
  for (const [k, v] of Object.entries(info)) info[k] = maskNumbers(v);
  return info;
})();

const logger = winston.createLogger({
  level: LOG_LEVEL,
  format: winston.format.combine(
    redactPhones,
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
  phone,
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
      phone,
      action,
      status,
      ip,
      level,
      category,
      resourceId,
      details || null,
    ]);
    logger.info('Audit captured', { tenantId, phone, action, status, category, level });
  } catch (err) {
    logger.error('Critical audit log failure', { err: err.message });
  }
};

module.exports = {
  // Exported for its own test: the redaction is a security property, and a
  // pure function is the honest way to prove it.
  maskNumbers, logger, captureAudit };
