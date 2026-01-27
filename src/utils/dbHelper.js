// src/utils/dbHelper.js
// Database connection helper utilities
// Provides reusable patterns for database operations with automatic connection management

const db = require('../config/db');
const { logger } = require('./logger');
const MESSAGES = require('../config/messages');
const { HttpError } = require('../middleware/errorHandler');

/**
 * Executes a callback with a database connection.
 * Automatically manages connection acquisition and release.
 * @param {Function} callback - Async function that receives the connection
 * @returns {Promise<any>} Result from the callback
 * @example
 * const result = await withConnection(async (conn) => {
 *   const [rows] = await conn.execute(query, params);
 *   return rows;
 * });
 */
const withConnection = async (callback) => {
  const connection = await db.getConnection();
  try {
    return await callback(connection);
  } finally {
    connection.release();
  }
};

/**
 * Executes a callback within a database transaction.
 * Automatically commits on success or rolls back on error.
 * @param {Function} callback - Async function that receives the connection
 * @returns {Promise<any>} Result from the callback
 * @example
 * const result = await withTransaction(async (conn) => {
 *   await conn.execute(query1, params1);
 *   await conn.execute(query2, params2);
 *   return result;
 * });
 */
const withTransaction = async (callback) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const result = await callback(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

/**
 * Executes a query and returns the first row or throws 404 if not found.
 * @param {string} query - SQL query
 * @param {Array} params - Query parameters
 * @param {string} entityName - Name of entity for error message
 * @returns {Promise<Object>} First row
 */
const findOneOrFail = async (query, params, entityName = 'Resource') => {
  return await withConnection(async (connection) => {
    const [rows] = await connection.execute(query, params);
    if (rows.length === 0) {
      logger.warn(`${entityName} not found`, { params });
      throw new HttpError(
        `${entityName} not found`,
        MESSAGES.HTTP_STATUS.NOT_FOUND
      );
    }
    return rows[0];
  });
};

/**
 * Executes a query and returns all rows.
 * @param {string} query - SQL query
 * @param {Array} params - Query parameters
 * @returns {Promise<Array>} Array of rows
 */
const findAll = async (query, params = []) => {
  return await withConnection(async (connection) => {
    const [rows] = await connection.execute(query, params);
    return rows;
  });
};

/**
 * Executes an insert/update/delete query.
 * @param {string} query - SQL query
 * @param {Array} params - Query parameters
 * @returns {Promise<Object>} Query result
 */
const executeQuery = async (query, params = []) => {
  return await withConnection(async (connection) => {
    const [result] = await connection.execute(query, params);
    return result;
  });
};

module.exports = {
  withConnection,
  withTransaction,
  findOneOrFail,
  findAll,
  executeQuery,
};
