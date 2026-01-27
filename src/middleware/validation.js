// src/middleware/validation.js
// Reusable validation middleware for route parameters and query strings.
// Can be used across all modules for common validation patterns.

const Joi = require('joi');
const { logger } = require('../utils/logger');
const MESSAGES = require('../config/messages');
const { HttpError } = require('./errorHandler');

/**
 * Middleware to validate request body against a Joi schema.
 * @param {Object} schema - Joi validation schema
 * @returns {Function} Express middleware function
 * @example
 * router.post('/', validateBody(createSchema), controller.create);
 */
const validateBody = (schema) => {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.body);
    if (error) {
      logger.warn('Request body validation failed', {
        error: error.details,
      });
      return next(
        new HttpError(
          `${MESSAGES.ERROR.VALIDATION_ERROR}${error.details[0].message}`,
          MESSAGES.HTTP_STATUS.BAD_REQUEST
        )
      );
    }
    req.validatedBody = value;
    next();
  };
};

/**
 * Middleware to validate query parameters against a Joi schema.
 * @param {Object} schema - Joi validation schema
 * @returns {Function} Express middleware function
 * @example
 * router.get('/', validateQuery(paginationSchema), controller.getAll);
 */
const validateQuery = (schema) => {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.query);
    if (error) {
      logger.warn('Query parameters validation failed', {
        error: error.details,
      });
      return next(
        new HttpError(
          `${MESSAGES.ERROR.VALIDATION_ERROR}${error.details[0].message}`,
          MESSAGES.HTTP_STATUS.BAD_REQUEST
        )
      );
    }
    req.validatedQuery = value;
    next();
  };
};

/**
 * Middleware to validate UUID parameters.
 * @param {string} paramName - Name of the parameter to validate (e.g., 'id', 'userId').
 * @returns {Function} Express middleware function.
 * @example
 * // In routes:
 * router.get('/:id', validateUuidParam('id'), controller.getById);
 */
const validateUuidParam = (paramName) => {
  const schema = Joi.object({
    [paramName]: Joi.string().uuid().required(),
  });

  return (req, res, next) => {
    const { error } = schema.validate(req.params);
    if (error) {
      logger.warn('UUID parameter validation failed', {
        param: paramName,
        value: req.params[paramName],
        error: error.details,
      });
      return next(
        new HttpError(
          `${MESSAGES.ERROR.VALIDATION_ERROR}${error.details[0].message}`,
          MESSAGES.HTTP_STATUS.BAD_REQUEST
        )
      );
    }
    next();
  };
};

/**
 * Middleware to validate multiple UUID parameters.
 * @param {...string} paramNames - Names of parameters to validate.
 * @returns {Function} Express middleware function.
 * @example
 * // In routes:
 * router.get('/:userId/:itemId', validateUuidParams('userId', 'itemId'), controller.get);
 */
const validateUuidParams = (...paramNames) => {
  const schemaObject = {};
  paramNames.forEach((param) => {
    schemaObject[param] = Joi.string().uuid().required();
  });
  const schema = Joi.object(schemaObject);

  return (req, res, next) => {
    const { error } = schema.validate(req.params);
    if (error) {
      logger.warn('UUID parameters validation failed', {
        params: paramNames,
        values: req.params,
        error: error.details,
      });
      return next(
        new HttpError(
          `${MESSAGES.ERROR.VALIDATION_ERROR}${error.details[0].message}`,
          MESSAGES.HTTP_STATUS.BAD_REQUEST
        )
      );
    }
    next();
  };
};

/**
 * Middleware to validate request parameters against a Joi schema.
 * @param {Object} schema - Joi validation schema
 * @returns {Function} Express middleware function
 * @example
 * router.get('/:id', validateParams(uuidParamSchema), controller.getById);
 */
const validateParams = (schema) => {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.params);
    if (error) {
      logger.warn('Request parameters validation failed', {
        error: error.details,
      });
      return next(
        new HttpError(
          `${MESSAGES.ERROR.VALIDATION_ERROR}${error.details[0].message}`,
          MESSAGES.HTTP_STATUS.BAD_REQUEST
        )
      );
    }
    req.validatedParams = value;
    next();
  };
};

module.exports = {
  validateBody,
  validateQuery,
  validateParams,
  validateUuidParam,
  validateUuidParams,
};
