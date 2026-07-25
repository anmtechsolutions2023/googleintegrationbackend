// src/modules/mastersetup/mastersetup.controller.js
const service = require('./mastersetup.service');
const { asyncHandler } = require('../../utils/controllerHelper');
const { createdResponse } = require('../../utils/responseHelper');
const { validateBody } = require('../../middleware/validation');
const { bootstrapSchema } = require('./mastersetup.schemas');

const bootstrap = asyncHandler(async (req, res) => {
  const { tid: tenantId, email } = req.user;
  const ids = await service.bootstrap(req.validatedBody, tenantId, email);
  createdResponse(res, 'Master data created successfully', ids);
});

module.exports = {
  bootstrap: [validateBody(bootstrapSchema), bootstrap],
};
