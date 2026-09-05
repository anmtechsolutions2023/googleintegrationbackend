// src/middleware/errorHandler.js
// Global error handling middleware for Express.
// Logs errors and sends standardized JSON responses.

const { logger } = require('../utils/logger')
const MESSAGES = require('../config/messages')

class HttpError extends Error {
  // `code` is an optional machine-readable identifier (e.g. 'TENANT_SETUP_REQUIRED')
  // that clients can branch on instead of matching message text. When omitted the
  // error response carries no `code` field, exactly as before.
  constructor(message, statusCode, code = null) {
    super(message)
    this.statusCode = statusCode
    if (code) this.code = code
  }
}

const errorHandler = (err, req, res, next) => {
  logger.error('Unhandled error:', err)

  // Handle an unreachable database. These are socket-level failures raised
  // before any query runs — a wrong host or port, a firewall or IP allowlist
  // blocking us, or the server being down. They carry no statusCode of their
  // own, so without this branch they land in whatever default the caller set and
  // get reported as an application error, which sends debugging in exactly the
  // wrong direction.
  const DB_UNREACHABLE_CODES = [
    'ETIMEDOUT',
    'ECONNREFUSED',
    'ENOTFOUND',
    'EHOSTUNREACH',
    'ECONNRESET',
    'PROTOCOL_CONNECTION_LOST',
  ]
  // The pool refusing a waiter is overload, not breakage: mysql2 raises a plain
  // Error with no code when queueLimit is hit, so the message is the only handle.
  //
  // ER_CON_COUNT_ERROR is the same condition one level out — the DATABASE is out
  // of connections, not this pool — and it belongs here rather than with the
  // unreachable codes below: the host is up and answering, it is declining to
  // open another session. Left unclassified it fell through to the generic
  // branch and every caller saw an unhandled 500, which reads as a broken
  // endpoint instead of a busy server and sends debugging the wrong way.
  if (
    err.message === 'Queue limit reached.' ||
    err.message === 'No connections available.' ||
    err.code === 'ER_CON_COUNT_ERROR' ||
    err.errno === 1040
  ) {
    const serverIsFull = err.code === 'ER_CON_COUNT_ERROR' || err.errno === 1040
    logger.error(
      serverIsFull
        ? 'Database refused a new connection (ER_CON_COUNT_ERROR) — the SERVER is at max_connections. Every warm instance holds its own pool, so compare max_connections against DATABASE.MAX_IDLE x warm instances, not against CONNECTION_LIMIT.'
        : 'Connection pool exhausted — every pooled connection is busy and the wait queue is full.'
    )
    return res.status(MESSAGES.HTTP_STATUS.SERVICE_UNAVAILABLE).json({
      success: false,
      status: MESSAGES.HTTP_STATUS.SERVICE_UNAVAILABLE,
      message: MESSAGES.ERROR.DB_BUSY,
      error: 'DB_BUSY',
      code: 'DB_BUSY',
    })
  }

  if (DB_UNREACHABLE_CODES.includes(err.code)) {
    logger.error(
      `Database unreachable (${err.code}) — check DB_HOST/DB_PORT, the provider's IP allowlist, and that the service is running.`
    )
    return res.status(MESSAGES.HTTP_STATUS.SERVICE_UNAVAILABLE).json({
      success: false,
      status: MESSAGES.HTTP_STATUS.SERVICE_UNAVAILABLE,
      message: MESSAGES.ERROR.DB_UNAVAILABLE,
      error: 'DB_UNAVAILABLE',
      code: 'DB_UNAVAILABLE',
    })
  }

  // Handle MySQL duplicate entry error (ER_DUP_ENTRY, errno 1062)
  if (err.code === 'ER_DUP_ENTRY' || err.errno === 1062) {
    const match = err.message?.match(/for key '([^']+)'/)
    const constraintKey = match && match[1] ? match[1].split('.').pop() : null

    // Friendly messages for named composite constraints
    const CONSTRAINT_MESSAGES = {
      uk_contact_name_mobile:
        'A contact with this FirstName, LastName and MobileNo combination already exists.',
      uk_mplm_tagname:
        'A map provider location mapper with this TagName already exists.',
      uk_ad_tagname:
        'An address detail with this TagName already exists.',
      uk_ttc_tagname:
        'A transaction type config with this TagName already exists.',
    }

    let message
    if (constraintKey && CONSTRAINT_MESSAGES[constraintKey]) {
      message = CONSTRAINT_MESSAGES[constraintKey]
    } else {
      const fieldName = constraintKey || 'value'
      message = `A record with this ${fieldName} already exists.`
    }

    return res.status(MESSAGES.HTTP_STATUS.CONFLICT).json({
      success: false,
      status: MESSAGES.HTTP_STATUS.CONFLICT,
      message,
      error: 'DUPLICATE_ENTRY',
    })
  }

  // Handle MySQL foreign key reference error (ER_ROW_IS_REFERENCED_2, errno 1451)
  if (err.code === 'ER_ROW_IS_REFERENCED_2' || err.errno === 1451) {
    // Try to parse referencing table and column from the SQL message
    let referencingTable = null
    let referencingColumn = null
    try {
      const fkRegex =
        /`[^`]+`\.`([^`]+)`, CONSTRAINT `[^`]+` FOREIGN KEY \(`([^`]+)`\)/i
      const fkMatch = err.sqlMessage && err.sqlMessage.match(fkRegex)
      if (fkMatch) {
        referencingTable = fkMatch[1]
        referencingColumn = fkMatch[2]
      }
    } catch (parseErr) {
      // ignore parse errors and fall back to generic message
    }

    return res.status(MESSAGES.HTTP_STATUS.CONFLICT).json({
      success: false,
      status: MESSAGES.HTTP_STATUS.CONFLICT,
      error: 'RESOURCE_IN_USE',
      code: 'RESOURCE_IN_USE',
      message: 'Cannot delete resource — it is referenced by other records.',
      details: {
        referencingTable,
        referencingColumn,
      },
    })
  }

  const statusCode =
    err.statusCode || MESSAGES.HTTP_STATUS.INTERNAL_SERVER_ERROR
  const message =
    statusCode === MESSAGES.HTTP_STATUS.INTERNAL_SERVER_ERROR
      ? MESSAGES.INFO.INTERNAL_ERROR
      : err.message

  const body = {
    success: false,
    status: statusCode,
    message: message,
  }
  // Surface an explicit HttpError code (never a raw MySQL errno string) so
  // clients can branch on it. Absent for every error that does not set one.
  if (err.code && err instanceof HttpError) body.code = err.code

  res.status(statusCode).json(body)
}

module.exports = { errorHandler, HttpError }
