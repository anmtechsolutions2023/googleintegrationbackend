// src/modules/posstaff/posstaff.controller.js
// Controller layer for POS Staff — HTTP request/response handling.

const service = require('./posstaff.service');
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
} = require('./posstaff.schemas');
const { logger } = require('../../utils/logger');

const getAll = asyncHandler(async (req, res) => {
  const { tid: tenantId } = req.user;
  const { page, limit } = req.query;
  logger.info('PosStaff.getAll called', { tenantId, page, limit });
  const result = await service.getAll(tenantId, page, limit);
  paginatedResponse(res, result.data, result.pagination, 'POS Staffs retrieved successfully');
});

const getById = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { tid: tenantId } = req.user;
  logger.info('PosStaff.getById called', { id, tenantId });
  const record = await service.getById(id, tenantId);
  successResponse(res, record, 'POS Staff retrieved successfully');
});

const create = asyncHandler(async (req, res) => {
  const { tid: tenantId, email } = req.user;
  logger.info('PosStaff.create called', { tenantId, email });
  const created = await service.create(req.body, tenantId, email);
  createdResponse(res, created, 'POS Staff created successfully');
});

const update = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { tid: tenantId, email } = req.user;
  logger.info('PosStaff.update called', { id, tenantId, email });
  const updated = await service.update(id, req.body, tenantId, email);
  successResponse(res, updated, 'POS Staff updated successfully');
});

const deleteById = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { tid: tenantId } = req.user;
  logger.info('PosStaff.deleteById called', { id, tenantId });
  await service.remove(id, tenantId);
  noContentResponse(res, 'POS Staff deleted successfully');
});

module.exports = {
  getAll: [validateQuery(paginationSchema), getAll],
  getById: [validateParams(uuidParamSchema), getById],
  create: [validateBody(createSchema), create],
  update: [validateParams(uuidParamSchema), validateBody(updateSchema), update],
  deleteById: [validateParams(uuidParamSchema), deleteById],
};
