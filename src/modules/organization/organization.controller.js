// src/modules/organization/organization.controller.js
const service = require('./organization.service');
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
  createOrganizationSchema,
  updateOrganizationSchema,
  paginationSchema,
  uuidParamSchema,
} = require('./organization.schemas');

const getAll = asyncHandler(async (req, res) => {
  const { tid: tenantId } = req.user;
  const { page, limit } = req.query;
  const result = await service.getAll(tenantId, page, limit);
  paginatedResponse(
    res,
    result.data,
    result.pagination,
    'Organizations retrieved successfully'
  );
});

const getById = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { tid: tenantId } = req.user;
  const data = await service.getById(id, tenantId);
  successResponse(res, data, 'Organization retrieved successfully');
});

const create = asyncHandler(async (req, res) => {
  const { tid: tenantId, phone } = req.user;
  const newData = await service.create(req.body, tenantId, phone);
  createdResponse(res, newData, 'Organization created successfully');
});

const update = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { tid: tenantId, phone } = req.user;
  const updated = await service.update(id, req.body, tenantId, phone);
  successResponse(res, updated, 'Organization updated successfully');
});

const deleteById = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { tid: tenantId } = req.user;
  await service.delete(id, tenantId);
  noContentResponse(res, 'Organization deleted successfully');
});

module.exports = {
  getAll: [validateQuery(paginationSchema), getAll],
  getById: [validateParams(uuidParamSchema), getById],
  create: [validateBody(createOrganizationSchema), create],
  update: [
    validateParams(uuidParamSchema),
    validateBody(updateOrganizationSchema),
    update,
  ],
  deleteById: [validateParams(uuidParamSchema), deleteById],
};
