// src/modules/posexpense/posexpense.controller.js
// Controller layer for POS Expense — HTTP request/response handling.

const service = require('./posexpense.service');
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
  settleSchema,
  paginationSchema,
  uuidParamSchema,
} = require('./posexpense.schemas');
const { logger } = require('../../utils/logger');

const getAll = asyncHandler(async (req, res) => {
  const { tid: tenantId } = req.user;
  const { page, limit } = req.query;
  logger.info('PosExpense.getAll called', { tenantId, page, limit });
  const result = await service.getAll(tenantId, page, limit);
  paginatedResponse(res, result.data, result.pagination, 'POS Expenses retrieved successfully');
});

const getById = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { tid: tenantId } = req.user;
  logger.info('PosExpense.getById called', { id, tenantId });
  const record = await service.getById(id, tenantId);
  successResponse(res, record, 'POS Expense retrieved successfully');
});

const create = asyncHandler(async (req, res) => {
  const { tid: tenantId, email } = req.user;
  logger.info('PosExpense.create called', { tenantId, email });
  const created = await service.create(req.body, tenantId, email);
  createdResponse(res, created, 'POS Expense created successfully');
});

const update = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { tid: tenantId, email } = req.user;
  logger.info('PosExpense.update called', { id, tenantId, email });
  const updated = await service.update(id, req.body, tenantId, email);
  successResponse(res, updated, 'POS Expense updated successfully');
});

const deleteById = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { tid: tenantId } = req.user;
  logger.info('PosExpense.deleteById called', { id, tenantId });
  await service.remove(id, tenantId);
  noContentResponse(res, 'POS Expense deleted successfully');
});

// Domain actions. Each is a state move, not a field edit, which is why they are
// POSTs to their own paths rather than a Status field on the update body.
const approve = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { tid: tenantId, email } = req.user;
  logger.info('PosExpense.approve called', { id, tenantId, email });
  const record = await service.approve(id, tenantId, email);
  successResponse(res, record, 'Expense approved');
});

const reject = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { tid: tenantId, email } = req.user;
  logger.info('PosExpense.reject called', { id, tenantId, email });
  const record = await service.reject(id, tenantId, email);
  successResponse(res, record, 'Expense rejected');
});

const settle = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { tid: tenantId, email } = req.user;
  logger.info('PosExpense.settle called', { id, tenantId, email });
  const record = await service.settle(id, req.body, tenantId, email);
  successResponse(res, record, 'Expense settled and posted to the ledger');
});

module.exports = {
  getAll: [validateQuery(paginationSchema), getAll],
  getById: [validateParams(uuidParamSchema), getById],
  create: [validateBody(createSchema), create],
  update: [validateParams(uuidParamSchema), validateBody(updateSchema), update],
  deleteById: [validateParams(uuidParamSchema), deleteById],
  approve: [validateParams(uuidParamSchema), approve],
  reject: [validateParams(uuidParamSchema), reject],
  settle: [validateParams(uuidParamSchema), validateBody(settleSchema), settle],
};
