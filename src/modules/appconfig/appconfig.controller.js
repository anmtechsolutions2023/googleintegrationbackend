// src/modules/appconfig/appconfig.controller.js
// Controller-as-array handlers for global Application Configuration.

const { asyncHandler, extractUserContext } = require('../../utils/controllerHelper');
const { successResponse } = require('../../utils/responseHelper');
const { validateBody } = require('../../middleware/validation');
const service = require('./appconfig.service');
const schemas = require('./appconfig.schemas');
const MESSAGES = require('../../config/messages');
const { captureAudit } = require('../../utils/logger');
const { STATUSES, AUDIT_CATEGORIES, AUDIT_ACTIONS } = require('../../config/constants');

const getConfig = [
  asyncHandler(async (req, res) => {
    const config = await service.getConfig();
    successResponse(res, MESSAGES.SUCCESS.APP_CONFIG_RETRIEVED, config);
  }),
];

const updateConfig = [
  validateBody(schemas.updateConfigSchema),
  asyncHandler(async (req, res) => {
    const { userPhone: email, tenantId } = extractUserContext(req);
    const config = await service.updateConfig(req.validatedBody, email);

    await captureAudit(req, tenantId, email,
      AUDIT_ACTIONS.UPDATE_APP_CONFIG, STATUSES.SUCCESS,
      AUDIT_CATEGORIES.GENERAL, 'INFO', null);

    successResponse(res, MESSAGES.SUCCESS.APP_CONFIG_UPDATED, config);
  }),
];

module.exports = { getConfig, updateConfig };
