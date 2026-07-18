// src/modules/poskot/poskot.controller.js
// Controller layer for POS KOT — HTTP request/response handling.

const service = require('./poskot.service');
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
} = require('./poskot.schemas');
const { logger } = require('../../utils/logger');

const getAll = asyncHandler(async (req, res) => {
  const { tid: tenantId } = req.user;
  const { page, limit } = req.query;
  logger.info('PosKot.getAll called', { tenantId, page, limit });
  const result = await service.getAll(tenantId, page, limit);
  paginatedResponse(res, result.data, result.pagination, 'POS KOTs retrieved successfully');
});

const getById = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { tid: tenantId } = req.user;
  logger.info('PosKot.getById called', { id, tenantId });
  const record = await service.getById(id, tenantId);
  successResponse(res, record, 'POS KOT retrieved successfully');
});

const create = asyncHandler(async (req, res) => {
  const { tid: tenantId, email } = req.user;
  logger.info('PosKot.create called', { tenantId, email });
  const created = await service.create(req.body, tenantId, email);
  createdResponse(res, created, 'POS KOT created successfully');
});

const update = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { tid: tenantId, email } = req.user;
  logger.info('PosKot.update called', { id, tenantId, email });
  const updated = await service.update(id, req.body, tenantId, email);
  successResponse(res, updated, 'POS KOT updated successfully');
});

const deleteById = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { tid: tenantId } = req.user;
  logger.info('PosKot.deleteById called', { id, tenantId });
  await service.remove(id, tenantId);
  noContentResponse(res, 'POS KOT deleted successfully');
});

// Domain action: mark a KOT ready (KDS).
const markReady = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { tid: tenantId, email } = req.user;
  logger.info('PosKot.markReady called', { id, tenantId, email });
  const updated = await service.markReady(id, tenantId, email);
  successResponse(res, updated, 'POS KOT marked ready');
});

module.exports = {
  getAll: [validateQuery(paginationSchema), getAll],
  getById: [validateParams(uuidParamSchema), getById],
  create: [validateBody(createSchema), create],
  update: [validateParams(uuidParamSchema), validateBody(updateSchema), update],
  deleteById: [validateParams(uuidParamSchema), deleteById],
  markReady: [validateParams(uuidParamSchema), markReady],
};
