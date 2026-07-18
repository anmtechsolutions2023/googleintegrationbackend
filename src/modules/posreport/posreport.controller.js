// src/modules/posreport/posreport.controller.js
// Controller for POS Reports — aggregation endpoint only (no CRUD).

const service = require('./posreport.service');
const { asyncHandler } = require('../../utils/controllerHelper');
const { successResponse } = require('../../utils/responseHelper');
const { validateQuery } = require('../../middleware/validation');
const { querySchema } = require('./posreport.schemas');
const { logger } = require('../../utils/logger');

const getSummary = [
  validateQuery(querySchema),
  asyncHandler(async (req, res) => {
    const { tid: tenantId } = req.user;
    const days = Number(req.query.days) || 7;
    logger.info('PosReport.getSummary called', { tenantId, days });
    const data = await service.getSummary(tenantId, days);
    successResponse(res, 'POS report summary retrieved successfully', data);
  }),
];

module.exports = { getSummary };
