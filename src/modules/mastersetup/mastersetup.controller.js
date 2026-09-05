// src/modules/mastersetup/mastersetup.controller.js
const service = require('./mastersetup.service');
const { asyncHandler } = require('../../utils/controllerHelper');
const { createdResponse, successResponse } = require('../../utils/responseHelper');
const { validateBody } = require('../../middleware/validation');
const { bootstrapSchema } = require('./mastersetup.schemas');
const { reissueTokenWithSetupComplete } = require('../auth/auth.service');

const bootstrap = asyncHandler(async (req, res) => {
  const { tid: tenantId, phone } = req.user;
  const ids = await service.bootstrap(req.validatedBody, tenantId, phone);

  // The caller's JWT still says setupCompleted: false, so without a fresh token
  // they would finish the wizard and stay gated until it expired. Hand back a
  // re-signed token carrying the same identity and scopes with the flag flipped.
  //
  // Returned as a key on the existing ids map rather than as a new top-level
  // response field: createdResponse only forwards `data`, and this keeps the
  // response shape purely additive for existing consumers.
  const setupToken = reissueTokenWithSetupComplete(req.user);

  createdResponse(res, 'Master data created successfully', { ...ids, setupToken });
});

const getStatus = asyncHandler(async (req, res) => {
  const status = await service.getStatus(req.user.tid);
  successResponse(res, 'Tenancy setup status retrieved', status);
});

module.exports = {
  bootstrap: [validateBody(bootstrapSchema), bootstrap],
  getStatus: [getStatus],
};
