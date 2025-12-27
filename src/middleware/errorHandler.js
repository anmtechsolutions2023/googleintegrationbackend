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

  const statusCode = err.statusCode || 500
  const message =
    statusCode === 500 ? MESSAGES.INFO.INTERNAL_ERROR : err.message

  res.status(statusCode).json({
    success: false,
    status: statusCode,
    message: message,
  })
}

module.exports = { errorHandler, HttpError }
