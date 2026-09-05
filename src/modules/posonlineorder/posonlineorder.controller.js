// src/modules/posonlineorder/posonlineorder.controller.js
// Controller layer for POS Online Order — HTTP request/response handling.

const service = require('./posonlineorder.service');
const lifecycle = require('./posonlineorder.lifecycle');
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
  acceptSchema,
  rejectSchema,
  statusSchema,
  paginationSchema,
  queueQuerySchema,
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

/**
 * The expo queue: open work only, oldest first.
 *
 * Its own endpoint rather than a filter over getAll, because the screen it
 * feeds polls every few seconds and wants the four orders that need a decision
 * — not page one of a Friday night's history.
 */
const getQueue = asyncHandler(async (req, res) => {
  const { tid: tenantId } = req.user;
  const { branchId, statuses } = req.query;
  const parsed = statuses
    ? String(statuses).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
    : null;
  const rows = await service.getQueue(tenantId, { branchId, statuses: parsed });
  successResponse(res, rows, 'Online order queue retrieved successfully');
});

const getById = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { tid: tenantId } = req.user;
  logger.info('PosOnlineOrder.getById called', { id, tenantId });
  const record = await service.getById(id, tenantId);
  successResponse(res, record, 'POS Online Order retrieved successfully');
});

const create = asyncHandler(async (req, res) => {
  const { tid: tenantId, phone } = req.user;
  logger.info('PosOnlineOrder.create called', { tenantId, phone });
  const created = await service.create(req.body, tenantId, phone);
  createdResponse(res, created, 'POS Online Order created successfully');
});

const update = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { tid: tenantId, phone } = req.user;
  logger.info('PosOnlineOrder.update called', { id, tenantId, phone });
  const updated = await service.update(id, req.body, tenantId, phone);
  successResponse(res, updated, 'POS Online Order updated successfully');
});

const deleteById = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { tid: tenantId } = req.user;
  logger.info('PosOnlineOrder.deleteById called', { id, tenantId });
  await service.remove(id, tenantId);
  noContentResponse(res, 'POS Online Order deleted successfully');
});

// ── Domain actions ──────────────────────────────────────────────────────────

/** Accept: becomes a pos_order, fires a KOT, tells the portal. */
const accept = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { tid: tenantId, phone } = req.user;
  logger.info('PosOnlineOrder.accept called', { id, tenantId, phone });
  const result = await lifecycle.accept(id, req.body, tenantId, phone);
  successResponse(res, result, 'Order accepted and sent to the kitchen');
});

/** Reject: with a coded reason, because portals require one. */
const reject = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { tid: tenantId, phone } = req.user;
  logger.info('PosOnlineOrder.reject called', { id, tenantId, phone, reason: req.body.Reason });
  const result = await lifecycle.reject(id, req.body, tenantId, phone);
  successResponse(res, result, 'Order rejected');
});

/** Every stage change after accept, through one validated writer. */
const setStatus = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { tid: tenantId, phone } = req.user;
  logger.info('PosOnlineOrder.setStatus called', { id, tenantId, status: req.body.Status });
  const result = await lifecycle.setStatus(id, req.body, tenantId, phone);
  successResponse(res, result, `Order moved to ${req.body.Status}`);
});

module.exports = {
  getAll: [validateQuery(paginationSchema), getAll],
  getQueue: [validateQuery(queueQuerySchema), getQueue],
  getById: [validateParams(uuidParamSchema), getById],
  create: [validateBody(createSchema), create],
  update: [validateParams(uuidParamSchema), validateBody(updateSchema), update],
  deleteById: [validateParams(uuidParamSchema), deleteById],
  accept: [validateParams(uuidParamSchema), validateBody(acceptSchema), accept],
  reject: [validateParams(uuidParamSchema), validateBody(rejectSchema), reject],
  setStatus: [validateParams(uuidParamSchema), validateBody(statusSchema), setStatus],
};
