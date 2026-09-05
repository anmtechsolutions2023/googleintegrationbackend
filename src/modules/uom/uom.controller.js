// src/modules/uom/uom.controller.js
// Controller layer for UOM (Unit of Measure) operations
// Handles HTTP requests and responses with standardized patterns

const uomService = require('./uom.service');
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
  createUomSchema,
  updateUomSchema,
  paginationSchema,
  uuidParamSchema,
} = require('./uom.schemas');
const { logger } = require('../../utils/logger');

/**
 * Get all UOMs with pagination
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const getAllUom = asyncHandler(async (req, res) => {
  const { tid: tenantId } = req.user;
  const { page, limit } = req.query;

  logger.info('getAllUom called', { tenantId, page, limit });

  const result = await uomService.getAllUom(tenantId, page, limit);

  paginatedResponse(
    res,
    result.data,
    result.pagination,
    'UOMs retrieved successfully'
  );
});

/**
 * Get a specific UOM by ID
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const getUomById = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { tid: tenantId } = req.user;

  logger.info('getUomById called', { id, tenantId });

  const uom = await uomService.getUomById(id, tenantId);

  successResponse(res, uom, 'UOM retrieved successfully');
});

/**
 * Create a new UOM
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const createUom = asyncHandler(async (req, res) => {
  const { tid: tenantId, phone } = req.user;
  const uomData = req.body;

  logger.info('createUom called', { tenantId, phone });

  const newUom = await uomService.createUom(uomData, tenantId, phone);

  createdResponse(res, newUom, 'UOM created successfully');
});

/**
 * Update an existing UOM
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const updateUom = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { tid: tenantId, phone } = req.user;
  const updateData = req.body;

  logger.info('updateUom called', { id, tenantId, phone });

  const updatedUom = await uomService.updateUom(
    id,
    updateData,
    tenantId,
    phone
  );

  successResponse(res, updatedUom, 'UOM updated successfully');
});

/**
 * Delete a UOM
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
const deleteUom = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { tid: tenantId } = req.user;

  logger.info('deleteUom called', { id, tenantId });

  await uomService.deleteUom(id, tenantId);

  noContentResponse(res, 'UOM deleted successfully');
});

module.exports = {
  getAllUom: [validateQuery(paginationSchema), getAllUom],
  getUomById: [validateParams(uuidParamSchema), getUomById],
  createUom: [validateBody(createUomSchema), createUom],
  updateUom: [
    validateParams(uuidParamSchema),
    validateBody(updateUomSchema),
    updateUom,
  ],
  deleteUom: [validateParams(uuidParamSchema), deleteUom],
};
