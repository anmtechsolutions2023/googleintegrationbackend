// src/modules/paymentdetail/paymentdetail.controller.js
const service = require('./paymentdetail.service');
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
  getByIdQuerySchema,
} = require('./paymentdetail.schemas');

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
    'Payment details retrieved successfully'
  );
});

const getById = asyncHandler(async (req, res) => {
  const expand = req.query.expand === 'true' || req.query.expand === true;
  const data = await service.getById(req.params.id, req.user.tid, expand);
  successResponse(res, data, 'Payment detail retrieved successfully');
});

const create = asyncHandler(async (req, res) => {
  const newData = await service.create(req.body, req.user.tid, req.user.email);
  createdResponse(res, newData, 'Payment detail created successfully');
});

const update = asyncHandler(async (req, res) => {
  const updated = await service.update(
    req.params.id,
    req.body,
    req.user.tid,
    req.user.email
  );
  successResponse(res, updated, 'Payment detail updated successfully');
});

const deleteById = asyncHandler(async (req, res) => {
  await service.delete(req.params.id, req.user.tid);
  noContentResponse(res, 'Payment detail deleted successfully');
});

module.exports = {
  getAll: [validateQuery(paginationSchema), getAll],
  getById: [
    validateParams(uuidParamSchema),
    validateQuery(getByIdQuerySchema),
    getById,
  ],
  create: [validateBody(createSchema), create],
  update: [validateParams(uuidParamSchema), validateBody(updateSchema), update],
  deleteById: [validateParams(uuidParamSchema), deleteById],
};
