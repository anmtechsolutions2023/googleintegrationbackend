// src/middleware/errorHandler.js
// Global error handling middleware for Express.
// Logs errors and sends standardized JSON responses.

const { logger } = require('../utils/logger')
const MESSAGES = require('../config/messages')

class HttpError extends Error {
  constructor(message, statusCode) {
    super(message)
    this.statusCode = statusCode
  }
}

const errorHandler = (err, req, res, next) => {
  logger.error('Unhandled error:', err)

  // Handle MySQL duplicate entry error (ER_DUP_ENTRY, errno 1062)
  if (err.code === 'ER_DUP_ENTRY' || err.errno === 1062) {
    // Extract field name from error message for better context
    let fieldName = 'value'
    const match = err.message?.match(/for key '([^']+)'/)
    if (match && match[1]) {
      // Extract field name from constraint name (e.g., 'TaxTypes.Name' -> 'Name')
      const parts = match[1].split('.')
      fieldName = parts[parts.length - 1]
    }

    return res.status(MESSAGES.HTTP_STATUS.CONFLICT).json({
      success: false,
      status: MESSAGES.HTTP_STATUS.CONFLICT,
      message: `A record with this ${fieldName} already exists.`,
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

  res.status(statusCode).json({
    success: false,
    status: statusCode,
    message: message,
  })
}

module.exports = { errorHandler, HttpError }
