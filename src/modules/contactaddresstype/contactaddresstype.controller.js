// src/modules/contactaddresstype/contactaddresstype.controller.js
const service = require('./contactaddresstype.service');
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
} = require('./contactaddresstype.schemas');

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
    'Contact address types retrieved successfully'
  );
});

const getById = asyncHandler(async (req, res) => {
  const data = await service.getById(req.params.id, req.user.tid);
  successResponse(res, data, 'Contact address type retrieved successfully');
});

const create = asyncHandler(async (req, res) => {
  const newData = await service.create(req.body, req.user.tid, req.user.phone);
  createdResponse(res, newData, 'Contact address type created successfully');
});

const update = asyncHandler(async (req, res) => {
  const updated = await service.update(
    req.params.id,
    req.body,
    req.user.tid,
    req.user.phone
  );
  successResponse(res, updated, 'Contact address type updated successfully');
});

const deleteById = asyncHandler(async (req, res) => {
  await service.delete(req.params.id, req.user.tid);
  noContentResponse(res, 'Contact address type deleted successfully');
});

module.exports = {
  getAll: [validateQuery(paginationSchema), getAll],
  getById: [validateParams(uuidParamSchema), getById],
  create: [validateBody(createSchema), create],
  update: [validateParams(uuidParamSchema), validateBody(updateSchema), update],
  deleteById: [validateParams(uuidParamSchema), deleteById],
};
