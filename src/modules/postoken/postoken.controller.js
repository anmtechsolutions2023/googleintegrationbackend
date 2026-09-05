// src/modules/postoken/postoken.controller.js
// Controller layer for POS Token — HTTP request/response handling.

const service = require('./postoken.service');
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
  statsQuerySchema,
} = require('./postoken.schemas');
const reportService = require('./postoken.report.service');
const { logger } = require('../../utils/logger');

// branchId/date/status narrow the list to one queue on one day — what both the
// counter console and the customer display actually want. Omitting them all
// keeps the original unfiltered behaviour.
const getAll = asyncHandler(async (req, res) => {
  const { tid: tenantId } = req.user;
  const { page, limit, branchId, date, status } = req.query;
  logger.info('PosToken.getAll called', { tenantId, page, limit, branchId, date, status });
  const result = await service.getAll(tenantId, page, limit, { branchId, date, status });
  paginatedResponse(res, result.data, result.pagination, 'POS Tokens retrieved successfully');
});

const getById = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { tid: tenantId } = req.user;
  logger.info('PosToken.getById called', { id, tenantId });
  const record = await service.getById(id, tenantId);
  successResponse(res, record, 'POS Token retrieved successfully');
});

const create = asyncHandler(async (req, res) => {
  const { tid: tenantId, phone } = req.user;
  logger.info('PosToken.create called', { tenantId, phone });
  const created = await service.create(req.body, tenantId, phone);
  createdResponse(res, created, 'POS Token created successfully');
});

const update = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { tid: tenantId, phone } = req.user;
  logger.info('PosToken.update called', { id, tenantId, phone });
  const updated = await service.update(id, req.body, tenantId, phone);
  successResponse(res, updated, 'POS Token updated successfully');
});

const deleteById = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { tid: tenantId } = req.user;
  logger.info('PosToken.deleteById called', { id, tenantId });
  await service.remove(id, tenantId);
  noContentResponse(res, 'POS Token deleted successfully');
});

// Domain actions: the queue advancing. Kept off the generic PUT because
// "call #7" is an event with its own timestamp, not a field being edited.
const call = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { tid: tenantId, phone } = req.user;
  logger.info('PosToken.call called', { id, tenantId, phone });
  const token = await service.call(id, tenantId, phone);
  successResponse(res, token, 'Token called');
});

const serve = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { tid: tenantId, phone } = req.user;
  logger.info('PosToken.serve called', { id, tenantId, phone });
  const token = await service.serve(id, tenantId, phone);
  successResponse(res, token, 'Token served');
});

// How the queue performed: issued, served, and how long people waited. The
// money half of the same question is the ledger's channel report — a token is
// operational state, not an accounting document.
const stats = asyncHandler(async (req, res) => {
  const { tid: tenantId } = req.user;
  logger.info('PosToken.stats called', { tenantId, preset: req.validatedQuery.preset });
  const data = await reportService.queueStats(req.validatedQuery, tenantId);
  successResponse(res, data, 'Token queue statistics retrieved');
});

module.exports = {
  getAll: [validateQuery(paginationSchema), getAll],
  stats: [validateQuery(statsQuerySchema), stats],
  getById: [validateParams(uuidParamSchema), getById],
  create: [validateBody(createSchema), create],
  update: [validateParams(uuidParamSchema), validateBody(updateSchema), update],
  deleteById: [validateParams(uuidParamSchema), deleteById],
  call: [validateParams(uuidParamSchema), call],
  serve: [validateParams(uuidParamSchema), serve],
};
