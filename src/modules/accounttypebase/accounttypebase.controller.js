// src/modules/accounttypebase/accounttypebase.controller.js
const service = require('./accounttypebase.service');
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
  createAccountTypeBaseSchema,
  updateAccountTypeBaseSchema,
  paginationSchema,
  uuidParamSchema,
} = require('./accounttypebase.schemas');

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
    'Account type bases retrieved successfully'
  );
});

const getById = asyncHandler(async (req, res) => {
  const data = await service.getById(req.params.id, req.user.tid);
  successResponse(res, data, 'Account type base retrieved successfully');
});

const create = asyncHandler(async (req, res) => {
  const newData = await service.create(req.body, req.user.tid, req.user.phone);
  createdResponse(res, newData, 'Account type base created successfully');
});

const update = asyncHandler(async (req, res) => {
  const updated = await service.update(
    req.params.id,
    req.body,
    req.user.tid,
    req.user.phone
  );
  successResponse(res, updated, 'Account type base updated successfully');
});

const deleteById = asyncHandler(async (req, res) => {
  await service.delete(req.params.id, req.user.tid);
  noContentResponse(res, 'Account type base deleted successfully');
});

module.exports = {
  getAll: [validateQuery(paginationSchema), getAll],
  getById: [validateParams(uuidParamSchema), getById],
  create: [validateBody(createAccountTypeBaseSchema), create],
  update: [
    validateParams(uuidParamSchema),
    validateBody(updateAccountTypeBaseSchema),
    update,
  ],
  deleteById: [validateParams(uuidParamSchema), deleteById],
};
