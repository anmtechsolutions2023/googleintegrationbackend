// src/modules/posonlineorder/posonlineorder.controller.js
// Controller layer for POS Online Order — HTTP request/response handling.

const service = require('./posonlineorder.service');
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
} = require('./posonlineorder.schemas');
const { logger } = require('../../utils/logger');

const getAll = asyncHandler(async (req, res) => {
  const { tid: tenantId } = req.user;
  const { page, limit } = req.query;
  logger.info('PosOnlineOrder.getAll called', { tenantId, page, limit });
  const result = await service.getAll(tenantId, page, limit);
  paginatedResponse(res, result.data, result.pagination, 'POS Online Orders retrieved successfully');
});

const getById = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { tid: tenantId } = req.user;
  logger.info('PosOnlineOrder.getById called', { id, tenantId });
  const record = await service.getById(id, tenantId);
  successResponse(res, record, 'POS Online Order retrieved successfully');
});

const create = asyncHandler(async (req, res) => {
  const { tid: tenantId, email } = req.user;
  logger.info('PosOnlineOrder.create called', { tenantId, email });
  const created = await service.create(req.body, tenantId, email);
  createdResponse(res, created, 'POS Online Order created successfully');
});

const update = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { tid: tenantId, email } = req.user;
  logger.info('PosOnlineOrder.update called', { id, tenantId, email });
  const updated = await service.update(id, req.body, tenantId, email);
  successResponse(res, updated, 'POS Online Order updated successfully');
});

const deleteById = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { tid: tenantId } = req.user;
  logger.info('PosOnlineOrder.deleteById called', { id, tenantId });
  await service.remove(id, tenantId);
  noContentResponse(res, 'POS Online Order deleted successfully');
});

module.exports = {
  getAll: [validateQuery(paginationSchema), getAll],
  getById: [validateParams(uuidParamSchema), getById],
  create: [validateBody(createSchema), create],
  update: [validateParams(uuidParamSchema), validateBody(updateSchema), update],
  deleteById: [validateParams(uuidParamSchema), deleteById],
};
