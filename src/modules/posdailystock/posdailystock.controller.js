// src/modules/posdailystock/posdailystock.controller.js
// HTTP in, HTTP out. The four states and the guard belong to the resolver and
// the service, where they can be tested without a request.

const service = require('./posdailystock.service');
const { asyncHandler } = require('../../utils/controllerHelper');
const { successResponse } = require('../../utils/responseHelper');
const { validateQuery, validateBody, validateParams } = require('../../middleware/validation');
const {
  dayQuerySchema, setSchema, clearQuerySchema, itemParamSchema,
} = require('./posdailystock.schemas');
const { logger } = require('../../utils/logger');

/** Every tracked dish for one outlet on one day, including the ones not set. */
const list = asyncHandler(async (req, res) => {
  const { tid: tenantId } = req.user;
  const { branchId, date } = req.query;
  const result = await service.listForDay(branchId, tenantId, date);
  successResponse(res, 'Daily stock retrieved successfully', result);
});

/** How many were made. Leaves what has already sold alone. */
const set = asyncHandler(async (req, res) => {
  const { tid: tenantId, phone } = req.user;
  const { branchId } = req.query;
  const { itemMetaId, preparedQty, date } = req.validatedBody ?? req.body;

  logger.info('PosDailyStock.set called', { tenantId, branchId, itemMetaId, preparedQty, phone });
  const result = await service.setPrepared(
    { branchId, itemMetaId, date, preparedQty }, tenantId, phone,
  );
  successResponse(res, 'Daily stock updated successfully', result);
});

/** Back to "not available today" — distinct from a count of zero. */
const clear = asyncHandler(async (req, res) => {
  const { tid: tenantId, phone } = req.user;
  const { date } = req.query;
  const { itemMetaId } = req.params;

  logger.info('PosDailyStock.clear called', { tenantId, itemMetaId, phone });
  const result = await service.clearDay({ itemMetaId, date }, tenantId, phone);
  successResponse(res, 'Daily stock cleared successfully', result);
});

module.exports = {
  list: [validateQuery(dayQuerySchema), list],
  set: [validateQuery(dayQuerySchema), validateBody(setSchema), set],
  clear: [validateParams(itemParamSchema), validateQuery(clearQuerySchema), clear],
};
