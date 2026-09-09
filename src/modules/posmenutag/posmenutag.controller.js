// src/modules/posmenutag/posmenutag.controller.js
// Controller layer for POS Menu Tag — HTTP request/response handling.

const service = require('./posmenutag.service');
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
  tagTypeParamSchema,
} = require('./posmenutag.schemas');
const { logger } = require('../../utils/logger');

const getAll = asyncHandler(async (req, res) => {
  const { tid: tenantId } = req.user;
  const { page, limit } = req.query;
  logger.info('PosMenuTag.getAll called', { tenantId, page, limit });
  const result = await service.getAll(tenantId, page, limit);
  paginatedResponse(res, result.data, result.pagination, 'POS Menu Tags retrieved successfully');
});

// Deliberately unpaginated: a picker needs every tag of its type at once, and
// a paginated dropdown that silently stops at 10 is worse than no dropdown.
const getByType = asyncHandler(async (req, res) => {
  const { tagType } = req.params;
  const { tid: tenantId } = req.user;
  logger.info('PosMenuTag.getByType called', { tagType, tenantId });
  const records = await service.getByType(tagType, tenantId);
  successResponse(res, records, 'POS Menu Tags retrieved successfully');
});

const getById = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { tid: tenantId } = req.user;
  logger.info('PosMenuTag.getById called', { id, tenantId });
  const record = await service.getById(id, tenantId);
  successResponse(res, record, 'POS Menu Tag retrieved successfully');
});

const create = asyncHandler(async (req, res) => {
  const { tid: tenantId, phone } = req.user;
  logger.info('PosMenuTag.create called', { tenantId, phone });
  const created = await service.create(req.body, tenantId, phone);
  createdResponse(res, created, 'POS Menu Tag created successfully');
});

const update = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { tid: tenantId, phone } = req.user;
  logger.info('PosMenuTag.update called', { id, tenantId, phone });
  const updated = await service.update(id, req.body, tenantId, phone);
  successResponse(res, updated, 'POS Menu Tag updated successfully');
});

const deleteById = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { tid: tenantId } = req.user;
  logger.info('PosMenuTag.deleteById called', { id, tenantId });
  await service.remove(id, tenantId);
  noContentResponse(res, 'POS Menu Tag deleted successfully');
});

module.exports = {
  getAll: [validateQuery(paginationSchema), getAll],
  getByType: [validateParams(tagTypeParamSchema), getByType],
  getById: [validateParams(uuidParamSchema), getById],
  create: [validateBody(createSchema), create],
  update: [validateParams(uuidParamSchema), validateBody(updateSchema), update],
  deleteById: [validateParams(uuidParamSchema), deleteById],
};
