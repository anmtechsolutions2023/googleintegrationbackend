// src/modules/pricing/pricing.controller.js
const service = require('./pricing.service');
const { asyncHandler } = require('../../utils/controllerHelper');
const { successResponse } = require('../../utils/responseHelper');
const { validateBody } = require('../../middleware/validation');
const { quoteSchema } = require('./pricing.schemas');
const { HttpError } = require('../../middleware/errorHandler');
const MESSAGES = require('../../config/messages');

// Stateless: prices what the caller describes and stores nothing. Safe to call
// on every keystroke in a cart UI.
const quote = asyncHandler(async (req, res) => {
  const { lines, discount } = req.validatedBody;
  const result = await service.priceLines(lines, req.user.tid, { discount });
  successResponse(res, 'Pricing calculated', result);
});

const taxGroupRate = asyncHandler(async (req, res) => {
  const group = await service.getTaxGroupRate(req.params.taxGroupId, req.user.tid);
  if (!group) {
    throw new HttpError('Tax group not found.', MESSAGES.HTTP_STATUS.NOT_FOUND);
  }
  successResponse(res, 'Tax group rate retrieved', group);
});

module.exports = {
  quote: [validateBody(quoteSchema), quote],
  taxGroupRate: [taxGroupRate],
};
