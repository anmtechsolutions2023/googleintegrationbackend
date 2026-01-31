// src/modules/transactiontypeconversionmapper/transactiontypeconversionmapper.controller.js
const service = require('./transactiontypeconversionmapper.service');
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
} = require('./transactiontypeconversionmapper.schemas');

const getAll = asyncHandler(async (req, res) => {
  const result = await service.getAll(
    req.user.tid,
    req.query.page,
    req.query.limit
  );
  paginatedResponse(
    res,
    result.data,
    result.pagination,
    'Transaction type conversion mappers retrieved successfully'
  );
});

const getById = asyncHandler(async (req, res) => {
  const data = await service.getById(req.params.id, req.user.tid);
  successResponse(
    res,
    data,
    'Transaction type conversion mapper retrieved successfully'
  );
});

const create = asyncHandler(async (req, res) => {
  const newData = await service.create(req.body, req.user.tid, req.user.email);
  createdResponse(
    res,
    newData,
    'Transaction type conversion mapper created successfully'
  );
});

const update = asyncHandler(async (req, res) => {
  const updated = await service.update(
    req.params.id,
    req.body,
    req.user.tid,
    req.user.email
  );
  successResponse(
    res,
    updated,
    'Transaction type conversion mapper updated successfully'
  );
});

const deleteById = asyncHandler(async (req, res) => {
  await service.delete(req.params.id, req.user.tid);
  noContentResponse(
    res,
    'Transaction type conversion mapper deleted successfully'
  );
});

module.exports = {
  getAll: [validateQuery(paginationSchema), getAll],
  getById: [validateParams(uuidParamSchema), getById],
  create: [validateBody(createSchema), create],
  update: [validateParams(uuidParamSchema), validateBody(updateSchema), update],
  deleteById: [validateParams(uuidParamSchema), deleteById],
};
