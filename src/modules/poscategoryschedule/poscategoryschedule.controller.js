// src/modules/poscategoryschedule/poscategoryschedule.controller.js
// Controller layer for category availability windows.

const service = require('./poscategoryschedule.service');
const { asyncHandler } = require('../../utils/controllerHelper');
const { successResponse } = require('../../utils/responseHelper');
const { validateBody, validateParams } = require('../../middleware/validation');
const { replaceSchema, categoryParamSchema } = require('./poscategoryschedule.schemas');
const { logger } = require('../../utils/logger');

// Unpaginated: a weekly schedule is at most a couple of dozen rows and is read
// as a whole grid. Paginating it would split a week across pages.
const getForCategory = asyncHandler(async (req, res) => {
  const { categoryId } = req.params;
  const { tid: tenantId } = req.user;
  logger.info('PosCategorySchedule.getForCategory called', { categoryId, tenantId });
  const rules = await service.getForCategory(categoryId, tenantId);
  successResponse(res, rules, 'Category schedule retrieved successfully');
});

const getAllForTenant = asyncHandler(async (req, res) => {
  const { tid: tenantId } = req.user;
  logger.info('PosCategorySchedule.getAllForTenant called', { tenantId });
  const rules = await service.getAllForTenant(tenantId);
  successResponse(res, rules, 'Category schedules retrieved successfully');
});

// PUT, not POST: this replaces the category's whole week. Sending an empty
// Rules array clears it, which returns the category to always-available.
const replaceForCategory = asyncHandler(async (req, res) => {
  const { categoryId } = req.params;
  const { tid: tenantId, phone } = req.user;
  logger.info('PosCategorySchedule.replaceForCategory called', {
    categoryId, tenantId, rules: req.body.Rules.length,
  });
  const rules = await service.replaceForCategory(categoryId, req.body.Rules, tenantId, phone);
  successResponse(res, rules, 'Category schedule saved successfully');
});

const clearForCategory = asyncHandler(async (req, res) => {
  const { categoryId } = req.params;
  const { tid: tenantId, phone } = req.user;
  logger.info('PosCategorySchedule.clearForCategory called', { categoryId, tenantId });
  await service.clearForCategory(categoryId, tenantId, phone);
  successResponse(res, [], 'Category schedule cleared — the category is now always available');
});

module.exports = {
  getAllForTenant: [getAllForTenant],
  getForCategory: [validateParams(categoryParamSchema), getForCategory],
  replaceForCategory: [
    validateParams(categoryParamSchema),
    validateBody(replaceSchema),
    replaceForCategory,
  ],
  clearForCategory: [validateParams(categoryParamSchema), clearForCategory],
};
