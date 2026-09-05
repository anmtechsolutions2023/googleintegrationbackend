// src/modules/transactiontype/transactiontype.controller.js
const service = require('./transactiontype.service');
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
  createTransactionTypeSchema,
  updateTransactionTypeSchema,
  paginationSchema,
  uuidParamSchema,
  getByIdQuerySchema,
} = require('./transactiontype.schemas');

const getAll = asyncHandler(async (req, res) => {
  const expand = req.query.expand === 'true' || req.query.expand === true;
  const result = await service.getAll(
    req.user.tid,
    req.query.page,
    req.query.limit,
    expand
  );
  paginatedResponse(
    res,
    result.data,
    result.pagination,
    'Transaction types retrieved successfully'
  );
});

const getById = asyncHandler(async (req, res) => {
  const expand = req.query.expand === 'true' || req.query.expand === true;
  const data = await service.getById(req.params.id, req.user.tid, expand);
  successResponse(res, data, 'Transaction type retrieved successfully');
});

const create = asyncHandler(async (req, res) => {
  const newData = await service.create(req.body, req.user.tid, req.user.phone);
  createdResponse(res, newData, 'Transaction type created successfully');
});

const update = asyncHandler(async (req, res) => {
  const updated = await service.update(
    req.params.id,
    req.body,
    req.user.tid,
    req.user.phone
  );
  successResponse(res, updated, 'Transaction type updated successfully');
});

const deleteById = asyncHandler(async (req, res) => {
  await service.delete(req.params.id, req.user.tid);
  noContentResponse(res, 'Transaction type deleted successfully');
});

module.exports = {
  getAll: [validateQuery(paginationSchema), getAll],
  getById: [validateParams(uuidParamSchema), validateQuery(getByIdQuerySchema), getById],
  create: [validateBody(createTransactionTypeSchema), create],
  update: [
    validateParams(uuidParamSchema),
    validateBody(updateTransactionTypeSchema),
    update,
  ],
  deleteById: [validateParams(uuidParamSchema), deleteById],
};
