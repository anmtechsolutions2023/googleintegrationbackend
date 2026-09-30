// src/modules/posqr/posqr.controller.js
// HTTP layer for the staff side of QR table ordering. Validation in, one
// service call, one response shape out — no decisions are made here.

const { asyncHandler } = require('../../utils/controllerHelper');
const { successResponse } = require('../../utils/responseHelper');
const { validateBody, validateQuery, validateParams } = require('../../middleware/validation');
const codesService = require('./posqr.codes.service');
const settingsService = require('./posqr.settings.service');
const ordersService = require('./posqr.orders.service');
const limitsService = require('./posqr.limits.service');
const {
  branchQuerySchema,
  optionalBranchQuerySchema,
  tableParamSchema,
  orderParamSchema,
  settingsUpdateSchema,
  rejectSchema,
} = require('./posqr.schemas');

const listCodes = asyncHandler(async (req, res) => {
  const { tid: tenantId, phone } = req.user;
  const data = await codesService.listForBranch(req.query.branchId, tenantId, phone);
  successResponse(res, 'QR codes retrieved successfully', data);
});

const rotateCode = asyncHandler(async (req, res) => {
  const { tid: tenantId, phone } = req.user;
  const data = await codesService.rotate(req.params.tableId, tenantId, phone);
  successResponse(res, 'QR code rotated — print the new card for this table', data);
});

const getSettings = asyncHandler(async (req, res) => {
  const data = await settingsService.getSettings(req.query.branchId, req.user.tid);
  successResponse(res, 'QR ordering settings retrieved successfully', data);
});

const updateSettings = asyncHandler(async (req, res) => {
  const { tid: tenantId, phone } = req.user;
  const data = await settingsService.setSettings(req.query.branchId, req.body, tenantId, phone);
  successResponse(res, 'QR ordering settings saved', data);
});

const getLimits = asyncHandler(async (req, res) => {
  const data = await limitsService.getLimits(req.user.tid);
  successResponse(res, 'Diner code limits retrieved successfully', data);
});

const listPending = asyncHandler(async (req, res) => {
  const data = await ordersService.listPending(req.query.branchId || null, req.user.tid);
  successResponse(res, 'Pending QR orders retrieved successfully', data);
});

const listRejectionReasons = asyncHandler(async (req, res) => {
  const data = await ordersService.listRejectionReasons(req.user.tid);
  successResponse(res, 'Rejection reasons retrieved successfully', data);
});

const acceptOrder = asyncHandler(async (req, res) => {
  const { tid: tenantId, phone } = req.user;
  const data = await ordersService.accept(req.params.id, tenantId, phone);
  successResponse(res, 'QR order accepted and sent to the kitchen', data);
});

const rejectOrder = asyncHandler(async (req, res) => {
  const { tid: tenantId, phone } = req.user;
  const data = await ordersService.reject(req.params.id, req.body, tenantId, phone);
  successResponse(res, 'QR order rejected', data);
});

module.exports = {
  listCodes: [validateQuery(branchQuerySchema), listCodes],
  rotateCode: [validateParams(tableParamSchema), rotateCode],
  getSettings: [validateQuery(branchQuerySchema), getSettings],
  updateSettings: [validateQuery(branchQuerySchema), validateBody(settingsUpdateSchema), updateSettings],
  getLimits: [getLimits],
  listPending: [validateQuery(optionalBranchQuerySchema), listPending],
  listRejectionReasons: [listRejectionReasons],
  acceptOrder: [validateParams(orderParamSchema), acceptOrder],
  rejectOrder: [validateParams(orderParamSchema), validateBody(rejectSchema), rejectOrder],
};
