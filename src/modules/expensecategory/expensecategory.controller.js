// src/modules/expensecategory/expensecategory.controller.js
// Controller layer for the expense category master.

const service = require('./expensecategory.service');
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
} = require('./expensecategory.schemas');

const getAll = asyncHandler(async (req, res) => {
  const result = await service.getAll(req.user.tid, req.query.page, req.query.limit);
  paginatedResponse(res, result.data, result.pagination, 'Expense categories retrieved successfully');
});

const getById = asyncHandler(async (req, res) => {
  const record = await service.getById(req.params.id, req.user.tid);
  successResponse(res, record, 'Expense category retrieved successfully');
});

const create = asyncHandler(async (req, res) => {
  const created = await service.create(req.body, req.user.tid, req.user.email);
  createdResponse(res, created, 'Expense category created successfully');
});

const update = asyncHandler(async (req, res) => {
  const updated = await service.update(req.params.id, req.body, req.user.tid, req.user.email);
  successResponse(res, updated, 'Expense category updated successfully');
});

const deleteById = asyncHandler(async (req, res) => {
  await service.remove(req.params.id, req.user.tid);
  noContentResponse(res, 'Expense category deleted successfully');
});

module.exports = {
  getAll: [validateQuery(paginationSchema), getAll],
  getById: [validateParams(uuidParamSchema), getById],
  create: [validateBody(createSchema), create],
  update: [validateParams(uuidParamSchema), validateBody(updateSchema), update],
  deleteById: [validateParams(uuidParamSchema), deleteById],
};
