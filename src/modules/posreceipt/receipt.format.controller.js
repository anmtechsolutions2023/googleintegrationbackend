// src/modules/posreceipt/receipt.format.controller.js
// Controller layer for the receipt format — HTTP request/response handling.

const service = require('./receipt.format.service');
const { asyncHandler } = require('../../utils/controllerHelper');
const { successResponse } = require('../../utils/responseHelper');
const { validateQuery, validateBody } = require('../../middleware/validation');
const {
  branchQuerySchema, docQuerySchema, updateSchema, taxModeSchema,
} = require('./receipt.format.schemas');
const { logger } = require('../../utils/logger');

/** Every document's resolved settings — what a renderer reads. */
const getResolved = asyncHandler(async (req, res) => {
  const { tid: tenantId } = req.user;
  const { branchId } = req.query;
  logger.info('ReceiptFormat.getResolved called', { tenantId, branchId });
  const format = await service.resolveAll(branchId, tenantId);
  successResponse(res, format, 'Receipt format retrieved successfully');
});

/** One document's editable shape — what the format editor reads. */
const getSchema = asyncHandler(async (req, res) => {
  const { tid: tenantId } = req.user;
  const { branchId, doc } = req.query;
  logger.info('ReceiptFormat.getSchema called', { tenantId, branchId, doc });
  const described = await service.describe(doc, branchId, tenantId);
  successResponse(res, described, 'Receipt format schema retrieved successfully');
});

const update = asyncHandler(async (req, res) => {
  const { tid: tenantId, phone } = req.user;
  const { branchId, doc } = req.query;
  logger.info('ReceiptFormat.update called', { tenantId, branchId, doc, phone });
  const saved = await service.save(doc, req.body.values, branchId, tenantId, phone);
  successResponse(res, saved, 'Receipt format updated successfully');
});

const setTaxMode = asyncHandler(async (req, res) => {
  const { tid: tenantId, phone } = req.user;
  const { branchId } = req.query;
  logger.info('ReceiptFormat.setTaxMode called', { tenantId, branchId, phone });
  const format = await service.setTaxMode(req.body.taxMode, branchId, tenantId, phone);
  successResponse(res, format, 'Tax mode updated successfully');
});

module.exports = {
  getResolved: [validateQuery(branchQuerySchema), getResolved],
  getSchema:   [validateQuery(docQuerySchema), getSchema],
  update:      [validateQuery(docQuerySchema), validateBody(updateSchema), update],
  setTaxMode:  [validateQuery(branchQuerySchema), validateBody(taxModeSchema), setTaxMode],
};
