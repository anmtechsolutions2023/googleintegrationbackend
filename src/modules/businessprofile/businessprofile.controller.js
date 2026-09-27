// src/modules/businessprofile/businessprofile.controller.js
// Controller layer for the business profile — HTTP request/response handling.

const service = require('./businessprofile.service');
const { asyncHandler } = require('../../utils/controllerHelper');
const { successResponse } = require('../../utils/responseHelper');
const { validateQuery, validateBody } = require('../../middleware/validation');
const { branchQuerySchema, updateSchema } = require('./businessprofile.schemas');
const { logger } = require('../../utils/logger');

/** Everything onboarding collected, plus what of it reaches the paper. */
const get = asyncHandler(async (req, res) => {
  const { tid: tenantId } = req.user;
  const { branchId } = req.query;
  const profile = await service.get(branchId, tenantId);
  successResponse(res, profile, 'Business profile retrieved successfully');
});

/** One transaction across four tables. Returns the profile as it now stands. */
const update = asyncHandler(async (req, res) => {
  const { tid: tenantId, phone } = req.user;
  const { branchId } = req.query;
  logger.info('BusinessProfile.update called', { tenantId, branchId, phone });
  const saved = await service.update(
    req.validatedBody ?? req.body, branchId, tenantId, phone,
  );
  successResponse(res, saved, 'Business profile updated successfully');
});

module.exports = {
  get:    [validateQuery(branchQuerySchema), get],
  update: [validateQuery(branchQuerySchema), validateBody(updateSchema), update],
};
