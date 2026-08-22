// src/modules/poscustomer/poscustomer.controller.js
// Controller layer for POS Customer — HTTP request/response handling.

const service = require('./poscustomer.service');
const profileService = require('./poscustomer.profile.service');
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
  searchQuerySchema,
} = require('./poscustomer.schemas');
const { logger } = require('../../utils/logger');

const getAll = asyncHandler(async (req, res) => {
  const { tid: tenantId } = req.user;
  const { page, limit } = req.query;
  logger.info('PosCustomer.getAll called', { tenantId, page, limit });
  const result = await service.getAll(tenantId, page, limit);
  paginatedResponse(res, result.data, result.pagination, 'POS Customers retrieved successfully');
});

const getById = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { tid: tenantId } = req.user;
  logger.info('PosCustomer.getById called', { id, tenantId });
  const record = await service.getById(id, tenantId);
  successResponse(res, record, 'POS Customer retrieved successfully');
});

// The till's type-ahead: find a regular by the number they recite at the
// counter. Capped server-side — this backs a lookup beside a queue, not an
// export.
const search = asyncHandler(async (req, res) => {
  const { tid: tenantId } = req.user;
  const { q } = req.query;
  logger.info('PosCustomer.search called', { tenantId, q });
  const results = await profileService.search(q, tenantId);
  successResponse(res, results, 'Customers found');
});

// Who they are, what they have spent, every round and every rating. The CRM
// screen listed three counters that were always zero; this is what makes it a
// profile rather than a phone book.
const getProfile = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { tid: tenantId } = req.user;
  logger.info('PosCustomer.getProfile called', { id, tenantId });
  const profile = await profileService.getProfile(id, tenantId);
  successResponse(res, profile, 'Customer profile retrieved');
});

const create = asyncHandler(async (req, res) => {
  const { tid: tenantId, email } = req.user;
  logger.info('PosCustomer.create called', { tenantId, email });
  const created = await service.create(req.body, tenantId, email);
  createdResponse(res, created, 'POS Customer created successfully');
});

const update = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { tid: tenantId, email } = req.user;
  logger.info('PosCustomer.update called', { id, tenantId, email });
  const updated = await service.update(id, req.body, tenantId, email);
  successResponse(res, updated, 'POS Customer updated successfully');
});

const deleteById = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { tid: tenantId } = req.user;
  logger.info('PosCustomer.deleteById called', { id, tenantId });
  await service.remove(id, tenantId);
  noContentResponse(res, 'POS Customer deleted successfully');
});

module.exports = {
  getAll: [validateQuery(paginationSchema), getAll],
  getById: [validateParams(uuidParamSchema), getById],
  search: [validateQuery(searchQuerySchema), search],
  getProfile: [validateParams(uuidParamSchema), getProfile],
  create: [validateBody(createSchema), create],
  update: [validateParams(uuidParamSchema), validateBody(updateSchema), update],
  deleteById: [validateParams(uuidParamSchema), deleteById],
};
