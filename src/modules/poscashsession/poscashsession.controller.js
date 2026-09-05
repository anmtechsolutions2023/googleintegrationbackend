// src/modules/poscashsession/poscashsession.controller.js
// Controller layer for cash sessions — HTTP request/response handling.

const service = require('./poscashsession.service');
const { asyncHandler } = require('../../utils/controllerHelper');
const {
  successResponse,
  paginatedResponse,
  createdResponse,
} = require('../../utils/responseHelper');
const {
  validateBody,
  validateQuery,
  validateParams,
} = require('../../middleware/validation');
const {
  openSchema,
  closeSchema,
  paginationSchema,
  uuidParamSchema,
} = require('./poscashsession.schemas');
const { logger } = require('../../utils/logger');

const getAll = asyncHandler(async (req, res) => {
  const { tid: tenantId } = req.user;
  const { page, limit } = req.query;
  logger.info('PosCashSession.getAll called', { tenantId, page, limit });
  const result = await service.getAll(tenantId, page, limit);
  paginatedResponse(res, result.data, result.pagination, 'Cash sessions retrieved successfully');
});

const getById = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { tid: tenantId } = req.user;
  const record = await service.getById(id, tenantId);
  successResponse(res, record, 'Cash session retrieved successfully');
});

const open = asyncHandler(async (req, res) => {
  const { tid: tenantId, phone } = req.user;
  logger.info('PosCashSession.open called', { tenantId, phone });
  const record = await service.open(req.body, tenantId, phone);
  createdResponse(res, record, 'Till opened');
});

const close = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { tid: tenantId, phone } = req.user;
  logger.info('PosCashSession.close called', { id, tenantId, phone });
  const record = await service.close(id, req.body, tenantId, phone);
  successResponse(res, record, 'Till closed');
});

/** Live expectation for an open till — the mid-shift check. */
const summary = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { tid: tenantId } = req.user;
  const record = await service.summary(id, tenantId);
  successResponse(res, record, 'Cash session summary retrieved');
});

module.exports = {
  getAll: [validateQuery(paginationSchema), getAll],
  getById: [validateParams(uuidParamSchema), getById],
  open: [validateBody(openSchema), open],
  close: [validateParams(uuidParamSchema), validateBody(closeSchema), close],
  summary: [validateParams(uuidParamSchema), summary],
};
