// src/modules/posbranch/posbranch.controller.js
// Controller layer for the POS branch picker.

const service = require('./posbranch.service');
const { asyncHandler } = require('../../utils/controllerHelper');
const { successResponse } = require('../../utils/responseHelper');
const { logger } = require('../../utils/logger');

const getAll = asyncHandler(async (req, res) => {
  const { tid: tenantId } = req.user;
  logger.info('PosBranch.getAll called', { tenantId });
  const branches = await service.list(tenantId);
  successResponse(res, branches, 'Branches retrieved successfully');
});

module.exports = { getAll: [getAll] };
