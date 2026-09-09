// src/modules/posaddon/posaddon.controller.js
// Controller layer for POS Add-on — HTTP request/response handling.

const service = require('./posaddon.service');
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
  groupParamSchema,
} = require('./posaddon.schemas');
const { logger } = require('../../utils/logger');

const getAll = asyncHandler(async (req, res) => {
  const { tid: tenantId } = req.user;
  const { page, limit } = req.query;
  logger.info('PosAddon.getAll called', { tenantId, page, limit });
  const result = await service.getAll(tenantId, page, limit);
  paginatedResponse(res, result.data, result.pagination, 'POS Add-ons retrieved successfully');
});

// Deliberately unpaginated: a group's options are drawn as one block, and a
// choice list that silently stops at 10 hides options the customer can order.
const getByGroup = asyncHandler(async (req, res) => {
  const { addonGroupId } = req.params;
  const { tid: tenantId } = req.user;
  logger.info('PosAddon.getByGroup called', { addonGroupId, tenantId });
  const records = await service.getByGroup(addonGroupId, tenantId);
  successResponse(res, records, 'POS Add-ons retrieved successfully');
});

const getById = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { tid: tenantId } = req.user;
  logger.info('PosAddon.getById called', { id, tenantId });
  const record = await service.getById(id, tenantId);
  successResponse(res, record, 'POS Add-on retrieved successfully');
});

const create = asyncHandler(async (req, res) => {
  const { tid: tenantId, phone } = req.user;
  logger.info('PosAddon.create called', { tenantId, phone });
  const created = await service.create(req.body, tenantId, phone);
  createdResponse(res, created, 'POS Add-on created successfully');
});

const update = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { tid: tenantId, phone } = req.user;
  logger.info('PosAddon.update called', { id, tenantId, phone });
  const updated = await service.update(id, req.body, tenantId, phone);
  successResponse(res, updated, 'POS Add-on updated successfully');
});

const deleteById = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { tid: tenantId } = req.user;
  logger.info('PosAddon.deleteById called', { id, tenantId });
  await service.remove(id, tenantId);
  noContentResponse(res, 'POS Add-on deleted successfully');
});

module.exports = {
  getAll: [validateQuery(paginationSchema), getAll],
  getByGroup: [validateParams(groupParamSchema), getByGroup],
  getById: [validateParams(uuidParamSchema), getById],
  create: [validateBody(createSchema), create],
  update: [validateParams(uuidParamSchema), validateBody(updateSchema), update],
  deleteById: [validateParams(uuidParamSchema), deleteById],
};
