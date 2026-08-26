// src/modules/loyalty/loyalty.controller.js
// Controller layer for loyalty — HTTP request/response handling.

const service = require('./loyalty.service');
const { asyncHandler } = require('../../utils/controllerHelper');
const { successResponse } = require('../../utils/responseHelper');
const { validateBody, validateParams } = require('../../middleware/validation');
const { uuidParamSchema, adjustSchema } = require('./loyalty.schemas');
const { logger } = require('../../utils/logger');

/** What a customer holds, and every movement that got them there. */
const getStatement = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { tid: tenantId } = req.user;
  const statement = await service.getStatement(id, tenantId);
  successResponse(res, statement, 'Loyalty statement retrieved successfully');
});

/** A manual grant or correction, always with a reason on the entry. */
const adjust = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { tid: tenantId, email } = req.user;
  logger.info('Loyalty.adjust called', { customerId: id, points: req.body.Points, tenantId, email });
  const result = await service.adjust(
    { customerId: id, points: req.body.Points, reason: req.body.Reason },
    tenantId,
    email,
  );
  successResponse(res, result, 'Loyalty points adjusted successfully');
});

module.exports = {
  getStatement: [validateParams(uuidParamSchema), getStatement],
  adjust: [validateParams(uuidParamSchema), validateBody(adjustSchema), adjust],
};
