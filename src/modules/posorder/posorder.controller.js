// src/modules/posorder/posorder.controller.js
// Controller layer for POS Order — HTTP request/response handling.

const service = require('./posorder.service');
const detailService = require('./posorder.detail.service');
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
  transferSchema,
} = require('./posorder.schemas');
const { logger } = require('../../utils/logger');

// `tableId` narrows the list to one table's rounds — what Billing needs when a
// cashier selects an occupied table and has to resume its session. Without it
// the client had to pull the whole (page-capped) order list and filter locally,
// which silently missed rounds once an outlet passed a page of orders.
// Omitting the filter keeps the original behaviour exactly.
const getAll = asyncHandler(async (req, res) => {
  const { tid: tenantId } = req.user;
  const { page, limit, tableId, openOnly } = req.query;
  logger.info('PosOrder.getAll called', { tenantId, page, limit, tableId, openOnly });
  const result = await service.getAll(tenantId, page, limit, { tableId, openOnly });
  paginatedResponse(res, result.data, result.pagination, 'POS Orders retrieved successfully');
});

const getById = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { tid: tenantId } = req.user;
  logger.info('PosOrder.getById called', { id, tenantId });
  const record = await service.getById(id, tenantId);
  successResponse(res, record, 'POS Order retrieved successfully');
});

// The round plus its token, tickets and invoice — what the shared order-detail
// modal renders, wherever an order number was clicked.
const getDetail = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { tid: tenantId } = req.user;
  logger.info('PosOrder.getDetail called', { id, tenantId });
  const detail = await detailService.getOrderDetail(id, tenantId);
  successResponse(res, detail, 'POS Order detail retrieved successfully');
});

const create = asyncHandler(async (req, res) => {
  const { tid: tenantId, phone } = req.user;
  logger.info('PosOrder.create called', { tenantId, phone });
  const created = await service.create(req.body, tenantId, phone);
  createdResponse(res, created, 'POS Order created successfully');
});

const update = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { tid: tenantId, phone } = req.user;
  logger.info('PosOrder.update called', { id, tenantId, phone });
  const updated = await service.update(id, req.body, tenantId, phone);
  successResponse(res, updated, 'POS Order updated successfully');
});

const deleteById = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { tid: tenantId, phone } = req.user;
  logger.info('PosOrder.deleteById called', { id, tenantId });
  await service.remove(id, tenantId, phone);
  noContentResponse(res, 'POS Order deleted successfully');
});

// Domain action: transfer items / rounds between tables (keep-as-served).
const transfer = asyncHandler(async (req, res) => {
  const { tid: tenantId, phone } = req.user;
  logger.info('PosOrder.transfer called', { tenantId, phone, scope: req.body.scope });
  const result = await service.transfer(req.body, tenantId, phone);
  successResponse(res, result, 'Order transferred successfully');
});

// Domain action: fire a KOT from this order.
const fireKot = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { tid: tenantId, phone } = req.user;
  logger.info('PosOrder.fireKot called', { id, tenantId, phone });
  const kot = await service.fireKot(id, req.body, tenantId, phone);
  createdResponse(res, kot, 'KOT fired successfully');
});

module.exports = {
  getAll: [validateQuery(paginationSchema), getAll],
  getById: [validateParams(uuidParamSchema), getById],
  getDetail: [validateParams(uuidParamSchema), getDetail],
  create: [validateBody(createSchema), create],
  update: [validateParams(uuidParamSchema), validateBody(updateSchema), update],
  deleteById: [validateParams(uuidParamSchema), deleteById],
  fireKot: [validateParams(uuidParamSchema), fireKot],
  transfer: [validateBody(transferSchema), transfer],
};
