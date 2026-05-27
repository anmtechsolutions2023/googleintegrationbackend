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

  res.status(statusCode).json({
    success: false,
    status: statusCode,
    message: message,
  })
}

module.exports = { errorHandler, HttpError }
