// src/utils/paginationHelper.js
// Pagination utilities for consistent paginated query handling
// Provides helpers for building paginated queries and calculating metadata

/**
 * Calculates pagination parameters.
 * @param {number} page - Page number (1-based)
 * @param {number} limit - Items per page
 * @returns {Object} {pageNum, limitNum, offset}
 */
const calculatePagination = (page = 1, limit = 10) => {
  const pageNum = Math.max(1, parseInt(page, 10));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10))); // Max 100 items
  const offset = (pageNum - 1) * limitNum;

  return { pageNum, limitNum, offset };
};

/**
 * Calculates pagination metadata.
 * @param {number} total - Total number of items
 * @param {number} page - Current page number
 * @param {number} limit - Items per page
 * @returns {Object} {page, limit, total, totalPages}
 */
const getPaginationMetadata = (total, page, limit) => {
  const totalPages = Math.ceil(total / limit);
  return {
    page,
    limit,
    total,
    totalPages,
    hasNextPage: page < totalPages,
    hasPreviousPage: page > 1,
  };
};

/**
 * Builds a paginated SQL query with LIMIT and OFFSET.
 * @param {string} baseQuery - Base SQL query without LIMIT/OFFSET
 * @param {number} limit - Items per page
 * @param {number} offset - Offset value
 * @returns {string} Complete SQL query with LIMIT and OFFSET
 */
const buildPaginatedQuery = (baseQuery, limit, offset) => {
  return `${baseQuery} LIMIT ${limit} OFFSET ${offset}`;
};

/**
 * Gets count from a COUNT query result.
 * @param {Array} countResult - Result from COUNT query
 * @returns {number} Total count
 */
const extractCount = (countResult) => {
  return countResult[0]?.total || countResult[0]?.count || 0;
};

module.exports = {
  calculatePagination,
  getPaginationMetadata,
  buildPaginatedQuery,
  extractCount,
};
