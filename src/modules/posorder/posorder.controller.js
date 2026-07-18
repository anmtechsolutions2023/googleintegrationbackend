// src/modules/posorder/posorder.controller.js
// Controller layer for POS Order — HTTP request/response handling.

const service = require('./posorder.service');
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
} = require('./posorder.schemas');
const { logger } = require('../../utils/logger');

const getAll = asyncHandler(async (req, res) => {
  const { tid: tenantId } = req.user;
  const { page, limit } = req.query;
  logger.info('PosOrder.getAll called', { tenantId, page, limit });
  const result = await service.getAll(tenantId, page, limit);
  paginatedResponse(res, result.data, result.pagination, 'POS Orders retrieved successfully');
});

const getById = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { tid: tenantId } = req.user;
  logger.info('PosOrder.getById called', { id, tenantId });
  const record = await service.getById(id, tenantId);
  successResponse(res, record, 'POS Order retrieved successfully');
});

const create = asyncHandler(async (req, res) => {
  const { tid: tenantId, email } = req.user;
  logger.info('PosOrder.create called', { tenantId, email });
  const created = await service.create(req.body, tenantId, email);
  createdResponse(res, created, 'POS Order created successfully');
});

const update = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { tid: tenantId, email } = req.user;
  logger.info('PosOrder.update called', { id, tenantId, email });
  const updated = await service.update(id, req.body, tenantId, email);
  successResponse(res, updated, 'POS Order updated successfully');
});

const deleteById = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { tid: tenantId } = req.user;
  logger.info('PosOrder.deleteById called', { id, tenantId });
  await service.remove(id, tenantId);
  noContentResponse(res, 'POS Order deleted successfully');
});

// Domain action: fire a KOT from this order.
const fireKot = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { tid: tenantId, email } = req.user;
  logger.info('PosOrder.fireKot called', { id, tenantId, email });
  const kot = await service.fireKot(id, req.body, tenantId, email);
  createdResponse(res, kot, 'KOT fired successfully');
});

module.exports = {
  getAll: [validateQuery(paginationSchema), getAll],
  getById: [validateParams(uuidParamSchema), getById],
  create: [validateBody(createSchema), create],
  update: [validateParams(uuidParamSchema), validateBody(updateSchema), update],
  deleteById: [validateParams(uuidParamSchema), deleteById],
  fireKot: [validateParams(uuidParamSchema), fireKot],
};
