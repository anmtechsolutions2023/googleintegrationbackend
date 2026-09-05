// src/modules/taxtype/taxtype.controller.js
// Controller layer for tax type operations
// Handles HTTP requests and responses with standardized patterns

const taxTypeService = require('./taxtype.service');
const { asyncHandler } = require('../../utils/controllerHelper');
const {
  successResponse,
  paginatedResponse,
  createdResponse,
  noContentResponse,
} = require('../../utils/responseHelper');
const {
  validateBody,
  validateQuery,
  validateParams,
} = require('../../middleware/validation');
const {
  createTaxTypeSchema,
  updateTaxTypeSchema,
  paginationSchema,
  uuidParamSchema,
} = require('./taxtype.schemas');
const { logger } = require('../../utils/logger');

/**
 * Get all tax types with pagination
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const getAllTaxTypes = asyncHandler(async (req, res) => {
  const { tid: tenantId } = req.user;
  const { page, limit } = req.query;

  logger.info('getAllTaxTypes called', { tenantId, page, limit });

  const result = await taxTypeService.getAllTaxTypes(tenantId, page, limit);

  paginatedResponse(
    res,
    result.data,
    result.pagination,
    'Tax types retrieved successfully'
  );
});

/**
 * Get a specific tax type by ID
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const getTaxTypeById = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { tid: tenantId } = req.user;

  logger.info('getTaxTypeById called', { id, tenantId });

  const taxType = await taxTypeService.getTaxTypeById(id, tenantId);

  successResponse(res, taxType, 'Tax type retrieved successfully');
});

/**
 * Create a new tax type
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const createTaxType = asyncHandler(async (req, res) => {
  const { tid: tenantId, phone } = req.user;
  const taxTypeData = req.body;

  logger.info('createTaxType called', { tenantId, phone });

  const newTaxType = await taxTypeService.createTaxType(
    taxTypeData,
    tenantId,
    phone
  );

  createdResponse(res, newTaxType, 'Tax type created successfully');
});

/**
 * Update an existing tax type
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const updateTaxType = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { tid: tenantId, phone } = req.user;
  const updateData = req.body;

  logger.info('updateTaxType called', { id, tenantId, phone });

  const updatedTaxType = await taxTypeService.updateTaxType(
    id,
    updateData,
    tenantId,
    phone
  );

  successResponse(res, updatedTaxType, 'Tax type updated successfully');
});

/**
 * Delete a tax type
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const deleteTaxType = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { tid: tenantId } = req.user;

  logger.info('deleteTaxType called', { id, tenantId });

  await taxTypeService.deleteTaxType(id, tenantId);

  noContentResponse(res, 'Tax type deleted successfully');
});

module.exports = {
  getAllTaxTypes: [validateQuery(paginationSchema), getAllTaxTypes],
  getTaxTypeById: [validateParams(uuidParamSchema), getTaxTypeById],
  createTaxType: [validateBody(createTaxTypeSchema), createTaxType],
  updateTaxType: [
    validateParams(uuidParamSchema),
    validateBody(updateTaxTypeSchema),
    updateTaxType,
  ],
  deleteTaxType: [validateParams(uuidParamSchema), deleteTaxType],
};
