// src/middleware/errorHandler.js

class HttpError extends Error {
  constructor(message, statusCode) {
    super(message)
    this.statusCode = statusCode
  }
}

const errorHandler = (err, req, res, next) => {
  console.error(err.stack)

  const statusCode = err.statusCode || 500
  const message = statusCode === 500 ? 'Internal Server Error' : err.message

  res.status(statusCode).json({
    success: false,
    status: statusCode,
    message: message,
  })
}

module.exports = { errorHandler, HttpError }
