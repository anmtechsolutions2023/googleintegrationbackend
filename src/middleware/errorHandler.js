// src/middleware/errorHandler.js
// Global error handling middleware for Express.
// Logs errors and sends standardized JSON responses.

const { logger } = require('../utils/logger');
const MESSAGES = require('../config/messages');

class HttpError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
  }
}

const errorHandler = (err, req, res, next) => {
  logger.error('Unhandled error:', err);

  // Handle MySQL duplicate entry error (ER_DUP_ENTRY, errno 1062)
  if (err.code === 'ER_DUP_ENTRY' || err.errno === 1062) {
    // Extract field name from error message for better context
    let fieldName = 'value';
    const match = err.message?.match(/for key '([^']+)'/);
    if (match && match[1]) {
      // Extract field name from constraint name (e.g., 'TaxTypes.Name' -> 'Name')
      const parts = match[1].split('.');
      fieldName = parts[parts.length - 1];
    }

    return res.status(MESSAGES.HTTP_STATUS.CONFLICT).json({
      success: false,
      status: MESSAGES.HTTP_STATUS.CONFLICT,
      message: `A record with this ${fieldName} already exists.`,
      error: 'DUPLICATE_ENTRY',
    });
  }

  const statusCode =
    err.statusCode || MESSAGES.HTTP_STATUS.INTERNAL_SERVER_ERROR;
  const message =
    statusCode === MESSAGES.HTTP_STATUS.INTERNAL_SERVER_ERROR
      ? MESSAGES.INFO.INTERNAL_ERROR
      : err.message;

  res.status(statusCode).json({
    success: false,
    status: statusCode,
    message: message,
  });
};

module.exports = { errorHandler, HttpError };
