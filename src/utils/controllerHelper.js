// src/utils/controllerHelper.js
// Controller helper utilities for reducing boilerplate code
// Provides async error handling and common controller patterns

const { logger } = require('./logger');
const MESSAGES = require('../config/messages');
const { HttpError } = require('../middleware/errorHandler');

/**
 * Wraps an async controller function with error handling.
 * Automatically catches errors and passes them to next().
 * @param {Function} fn - Async controller function
 * @returns {Function} Wrapped controller function
 * @example
 * router.get('/', asyncHandler(async (req, res) => {
 *   const data = await service.getAll();
 *   res.json(data);
 * }));
 */
const asyncHandler = (fn) => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

/**
 * Extracts tenant and user info from authenticated request.
 * @param {Object} req - Express request with authenticated user
 * @returns {Object} {tenantId, userEmail, userName}
 */
const extractUserContext = (req) => {
  return {
    tenantId: req.user.tid,
    userEmail: req.user.email,
    userName: req.user.name || req.user.email,
  };
};

/**
 * Validates request body against a Joi schema.
 * Throws HttpError if validation fails.
 * @param {Object} schema - Joi validation schema
 * @param {Object} data - Data to validate
 * @param {string} context - Context for error logging
 * @returns {Object} Validated data
 */
const validateRequest = (schema, data, context = 'Request') => {
  const { error, value } = schema.validate(data);
  if (error) {
    logger.warn(`${context} validation failed`, {
      error: error.details,
    });
    throw new HttpError(
      `${MESSAGES.ERROR.VALIDATION_ERROR}${error.details[0].message}`,
      MESSAGES.HTTP_STATUS.BAD_REQUEST
    );
  }
  return value;
};

/**
 * Logs controller action entry.
 * @param {string} action - Action name
 * @param {Object} context - Context data to log
 */
const logAction = (action, context = {}) => {
  logger.info(action, context);
};

/**
 * Logs controller success.
 * @param {string} action - Action name
 * @param {Object} context - Context data to log
 */
const logSuccess = (action, context = {}) => {
  logger.info(`${action} - Success`, context);
};

/**
 * Logs controller error.
 * @param {string} action - Action name
 * @param {Error} error - Error object
 */
const logError = (action, error) => {
  logger.error(`${action} - Error`, error);
};

module.exports = {
  asyncHandler,
  extractUserContext,
  validateRequest,
  logAction,
  logSuccess,
  logError,
};
