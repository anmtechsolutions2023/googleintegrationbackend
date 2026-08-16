// src/modules/asset/asset.controller.js
// Controller layer for the asset register — HTTP request/response handling.

const service = require('./asset.service');
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
  createSchema,
  updateSchema,
  paginationSchema,
  uuidParamSchema,
} = require('./asset.schemas');
const { logger } = require('../../utils/logger');

const getAll = asyncHandler(async (req, res) => {
  const { tid: tenantId } = req.user;
  const { page, limit } = req.query;
  logger.info('Asset.getAll called', { tenantId, page, limit });
  const result = await service.getAll(tenantId, page, limit);
  paginatedResponse(res, result.data, result.pagination, 'Assets retrieved successfully');
});

/** Registered before /:id so 'summary' is not read as an id. */
const summary = asyncHandler(async (req, res) => {
  const { tid: tenantId } = req.user;
  const result = await service.summary(tenantId);
  successResponse(res, result, 'Asset register summary retrieved');
});

const getById = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { tid: tenantId } = req.user;
  const record = await service.getById(id, tenantId);
  successResponse(res, record, 'Asset retrieved successfully');
});

const create = asyncHandler(async (req, res) => {
  const { tid: tenantId, email } = req.user;
  logger.info('Asset.create called', { tenantId, email });
  const created = await service.create(req.body, tenantId, email);
  createdResponse(res, created, 'Asset created successfully');
});

const update = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { tid: tenantId, email } = req.user;
  const updated = await service.update(id, req.body, tenantId, email);
  successResponse(res, updated, 'Asset updated successfully');
});

const deleteById = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { tid: tenantId } = req.user;
  await service.remove(id, tenantId);
  noContentResponse(res, 'Asset deleted successfully');
});

module.exports = {
  getAll: [validateQuery(paginationSchema), getAll],
  summary: [summary],
  getById: [validateParams(uuidParamSchema), getById],
  create: [validateBody(createSchema), create],
  update: [validateParams(uuidParamSchema), validateBody(updateSchema), update],
  deleteById: [validateParams(uuidParamSchema), deleteById],
};
