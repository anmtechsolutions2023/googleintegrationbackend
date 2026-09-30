// src/modules/pospaymentmethod/pospaymentmethod.controller.js
// Controller layer for per-branch payment methods — HTTP in, HTTP out.
//
// No rules live here. Deciding what "enabled" means for an outlet that has never
// been configured, and refusing a save that would leave a till unable to take
// money, both belong to the service — where they are testable without an HTTP
// request and reusable by anything that is not one.

const service = require('./pospaymentmethod.service');
const { asyncHandler } = require('../../utils/controllerHelper');
const { successResponse } = require('../../utils/responseHelper');
const { validateQuery, validateBody } = require('../../middleware/validation');
const { branchQuerySchema, saveSchema } = require('./pospaymentmethod.schemas');
const { logger } = require('../../utils/logger');

/** Every method in the catalogue, with this branch's effective state. */
const list = asyncHandler(async (req, res) => {
  const { tid: tenantId } = req.user;
  const { branchId } = req.query;

  const result = await service.listForBranch(branchId, tenantId);
  successResponse(res, 'Payment methods retrieved successfully', result);
});

/** Record this branch's decisions. Partial lists are normal — see the service. */
const save = asyncHandler(async (req, res) => {
  const { tid: tenantId, phone } = req.user;
  const { branchId } = req.query;
  const { methods } = req.validatedBody ?? req.body;

  logger.info('PosPaymentMethod.save called', {
    tenantId, branchId, count: methods.length, phone,
  });

  const result = await service.save(branchId, tenantId, methods, phone);
  successResponse(res, 'Payment methods updated successfully', result);
});

module.exports = {
  list: [validateQuery(branchQuerySchema), list],
  save: [validateQuery(branchQuerySchema), validateBody(saveSchema), save],
};
