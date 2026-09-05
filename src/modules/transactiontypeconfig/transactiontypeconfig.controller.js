// src/modules/transactiontypeconfig/transactiontypeconfig.controller.js
// Controller layer for Transaction Type Config operations

const service = require('./transactiontypeconfig.service');
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
  createTransactionTypeConfigSchema,
  updateTransactionTypeConfigSchema,
  paginationSchema,
  uuidParamSchema,
} = require('./transactiontypeconfig.schemas');
const { logger } = require('../../utils/logger');

const getAll = asyncHandler(async (req, res) => {
  const { tid: tenantId } = req.user;
  const { page, limit } = req.query;
  logger.info('getAll TransactionTypeConfig called', { tenantId, page, limit });
  const result = await service.getAll(tenantId, page, limit);
  paginatedResponse(
    res,
    result.data,
    result.pagination,
    'Transaction type configs retrieved successfully'
  );
});

const getById = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { tid: tenantId } = req.user;
  logger.info('getById TransactionTypeConfig called', { id, tenantId });
  const data = await service.getById(id, tenantId);
  successResponse(res, data, 'Transaction type config retrieved successfully');
});

const create = asyncHandler(async (req, res) => {
  const { tid: tenantId, phone } = req.user;
  logger.info('create TransactionTypeConfig called', { tenantId, phone });
  const newData = await service.create(req.body, tenantId, phone);
  createdResponse(res, newData, 'Transaction type config created successfully');
});

const update = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { tid: tenantId, phone } = req.user;
  logger.info('update TransactionTypeConfig called', { id, tenantId, phone });
  const updated = await service.update(id, req.body, tenantId, phone);
  successResponse(res, updated, 'Transaction type config updated successfully');
});

const deleteById = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { tid: tenantId } = req.user;
  logger.info('delete TransactionTypeConfig called', { id, tenantId });
  await service.delete(id, tenantId);
  noContentResponse(res, 'Transaction type config deleted successfully');
});

module.exports = {
  getAll: [validateQuery(paginationSchema), getAll],
  getById: [validateParams(uuidParamSchema), getById],
  create: [validateBody(createTransactionTypeConfigSchema), create],
  update: [
    validateParams(uuidParamSchema),
    validateBody(updateTransactionTypeConfigSchema),
    update,
  ],
  deleteById: [validateParams(uuidParamSchema), deleteById],
};
