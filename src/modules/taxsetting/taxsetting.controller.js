// src/modules/taxsetting/taxsetting.controller.js
const { asyncHandler } = require('../../utils/controllerHelper');
const { successResponse } = require('../../utils/responseHelper');
const { validateBody } = require('../../middleware/validation');
const { updateSchema, branchGstinSchema } = require('./taxsetting.schemas');
const service = require('./taxsetting.service');

const get = asyncHandler(async (req, res) => {
  successResponse(res, 'GST setting retrieved', await service.getStatus(req.user.tid));
});

const update = asyncHandler(async (req, res) => {
  const result = await service.setStatus(req.validatedBody, req.user.tid, req.user.phone);
  successResponse(res, 'GST setting updated', result);
});

const updateBranchGstin = asyncHandler(async (req, res) => {
  const result = await service.setBranchGstin(
    req.params.branchId, req.validatedBody.gstin, req.user.tid, req.user.phone,
  );
  successResponse(res, 'Branch GSTIN updated', result);
});

module.exports = {
  get: [get],
  update: [validateBody(updateSchema), update],
  updateBranchGstin: [validateBody(branchGstinSchema), updateBranchGstin],
};
