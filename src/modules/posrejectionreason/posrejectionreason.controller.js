// src/modules/posrejectionreason/posrejectionreason.controller.js
// Controller layer for POS Rejection Reason — HTTP request/response handling.

const service = require('./posrejectionreason.service');
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
  portalParamSchema,
} = require('./posrejectionreason.schemas');
const { logger } = require('../../utils/logger');

const getAll = asyncHandler(async (req, res) => {
  const { tid: tenantId } = req.user;
  const { page, limit } = req.query;
  logger.info('PosRejectionReason.getAll called', { tenantId, page, limit });
  const result = await service.getAll(tenantId, page, limit);
  paginatedResponse(res, result.data, result.pagination, 'POS Rejection Reasons retrieved successfully');
});

// Deliberately unpaginated: the reject dialog needs every reason it may offer
// in one read, and a paginated dropdown that silently stops at 10 would hide
// the reason the cashier is looking for.
const getForPortal = asyncHandler(async (req, res) => {
  const { portalId } = req.params;
  const { tid: tenantId } = req.user;
  logger.info('PosRejectionReason.getForPortal called', { portalId, tenantId });
  const records = await service.getForPortal(portalId, tenantId);
  successResponse(res, records, 'POS Rejection Reasons retrieved successfully');
});

const getById = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { tid: tenantId } = req.user;
  logger.info('PosRejectionReason.getById called', { id, tenantId });
  const record = await service.getById(id, tenantId);
  successResponse(res, record, 'POS Rejection Reason retrieved successfully');
});

const create = asyncHandler(async (req, res) => {
  const { tid: tenantId, phone } = req.user;
  logger.info('PosRejectionReason.create called', { tenantId, phone });
  const created = await service.create(req.body, tenantId, phone);
  createdResponse(res, created, 'POS Rejection Reason created successfully');
});

const update = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { tid: tenantId, phone } = req.user;
  logger.info('PosRejectionReason.update called', { id, tenantId, phone });
  const updated = await service.update(id, req.body, tenantId, phone);
  successResponse(res, updated, 'POS Rejection Reason updated successfully');
});

const deleteById = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { tid: tenantId } = req.user;
  logger.info('PosRejectionReason.deleteById called', { id, tenantId });
  await service.remove(id, tenantId);
  noContentResponse(res, 'POS Rejection Reason deleted successfully');
});

module.exports = {
  getAll: [validateQuery(paginationSchema), getAll],
  getForPortal: [validateParams(portalParamSchema), getForPortal],
  getById: [validateParams(uuidParamSchema), getById],
  create: [validateBody(createSchema), create],
  update: [validateParams(uuidParamSchema), validateBody(updateSchema), update],
  deleteById: [validateParams(uuidParamSchema), deleteById],
};
