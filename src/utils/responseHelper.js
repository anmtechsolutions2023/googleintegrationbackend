// src/utils/responseHelper.js
// Standardized response formatting utilities
// Ensures consistent API response structure across all endpoints

const MESSAGES = require('../config/messages');

/**
 * Sends a successful response with data.
 * @param {Object} res - Express response object
 * @param {string} message - Success message
 * @param {any} data - Response data
 * @param {number} statusCode - HTTP status code (default: 200)
 */
const successResponse = (res, message, data, statusCode = 200) => {
  res.status(statusCode).json({
    success: true,
    message,
    data,
  });
};

/**
 * Sends a successful response with pagination metadata.
 * @param {Object} res - Express response object
 * @param {string} message - Success message
 * @param {Array} data - Response data array
 * @param {Object} pagination - Pagination info {page, limit, total, totalPages}
 */
const paginatedResponse = (res, message, data, pagination) => {
  res.status(200).json({
    success: true,
    message,
    data,
    pagination,
  });
};

/**
 * Sends a created response (201).
 * @param {Object} res - Express response object
 * @param {string} message - Success message
 * @param {any} data - Created resource data
 */
const createdResponse = (res, message, data) => {
  res.status(MESSAGES.HTTP_STATUS.CREATED).json({
    success: true,
    message,
    data,
  });
};

/**
 * Sends a no content response (204).
 * @param {Object} res - Express response object
 */
const noContentResponse = (res) => {
  res.status(MESSAGES.HTTP_STATUS.NO_CONTENT).send();
};

/**
 * Sends an error response.
 * @param {Object} res - Express response object
 * @param {string} message - Error message
 * @param {number} statusCode - HTTP status code (default: 500)
 * @param {any} errors - Optional error details
 */
const errorResponse = (res, message, statusCode = 500, errors = null) => {
  const response = {
    success: false,
    message,
  };
  if (errors) {
    response.errors = errors;
  }
  res.status(statusCode).json(response);
};

module.exports = {
  successResponse,
  paginatedResponse,
  createdResponse,
  noContentResponse,
  errorResponse,
};
