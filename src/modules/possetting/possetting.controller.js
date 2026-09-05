// src/modules/possetting/possetting.controller.js
// Controller layer for per-branch POS settings — HTTP request/response handling.

const service = require('./possetting.service');
const { asyncHandler } = require('../../utils/controllerHelper');
const { successResponse } = require('../../utils/responseHelper');
const { validateQuery, validateBody } = require('../../middleware/validation');
const { branchQuerySchema, updateSchema } = require('./possetting.schemas');
const { logger } = require('../../utils/logger');

const getForBranch = asyncHandler(async (req, res) => {
  const { tid: tenantId } = req.user;
  const { branchId } = req.query;
  logger.info('PosSetting.getForBranch called', { tenantId, branchId });
  const settings = await service.getBranchSettings(branchId, tenantId);
  successResponse(res, settings, 'POS settings retrieved successfully');
});

const updateForBranch = asyncHandler(async (req, res) => {
  const { tid: tenantId, phone } = req.user;
  const { branchId } = req.query;
  logger.info('PosSetting.updateForBranch called', { tenantId, branchId, phone });
  const settings = await service.setBranchSettings(branchId, req.body, tenantId, phone);
  successResponse(res, settings, 'POS settings updated successfully');
});

module.exports = {
  getForBranch: [validateQuery(branchQuerySchema), getForBranch],
  updateForBranch: [
    validateQuery(branchQuerySchema), validateBody(updateSchema), updateForBranch,
  ],
};
