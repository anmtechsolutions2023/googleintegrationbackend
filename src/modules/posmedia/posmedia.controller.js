// src/modules/posmedia/posmedia.controller.js
// Controller layer for branch media — HTTP request/response handling.

const service = require('./posmedia.service');
const { asyncHandler } = require('../../utils/controllerHelper');
const { successResponse, createdResponse } = require('../../utils/responseHelper');
const { validateQuery, validateBody, validateParams } = require('../../middleware/validation');
const { branchQuerySchema, kindParamSchema, putSchema } = require('./posmedia.schemas');
const { logger } = require('../../utils/logger');

/** Both kinds' metadata for a branch. Never the bytes — see the service. */
const list = asyncHandler(async (req, res) => {
  const { tid: tenantId } = req.user;
  const { branchId } = req.query;
  const media = await service.list(branchId, tenantId);
  successResponse(res, 'Branch media retrieved successfully', media);
});

/** One image, bytes included as a data URI. */
const get = asyncHandler(async (req, res) => {
  const { tid: tenantId } = req.user;
  const { branchId } = req.query;
  const { kind } = req.params;
  const media = await service.get(kind, branchId, tenantId);

  // The bytes came from a caller once. Even though the type is decided by the
  // magic bytes rather than the upload's claim, the browser is told plainly not
  // to second-guess it — a sniffed content type is how an image endpoint starts
  // serving something executable.
  res.set('X-Content-Type-Options', 'nosniff');
  // Per-viewer, and revalidated: a replaced logo must not sit in a till's cache
  // until the tab is closed, and this is a tenant's own branding, not public.
  res.set('Cache-Control', 'private, max-age=0, must-revalidate');

  successResponse(res, 'Branch media retrieved successfully', media);
});

const put = asyncHandler(async (req, res) => {
  const { tid: tenantId, phone } = req.user;
  const { branchId } = req.query;
  const { kind, dataUri } = req.validatedBody ?? req.body;
  logger.info('PosMedia.put called', { tenantId, branchId, kind, phone });
  const stored = await service.put({ kind, dataUri, branchId }, tenantId, phone);
  createdResponse(res, 'Image saved successfully', stored);
});

const remove = asyncHandler(async (req, res) => {
  const { tid: tenantId, phone } = req.user;
  const { branchId } = req.query;
  const { kind } = req.params;
  logger.info('PosMedia.remove called', { tenantId, branchId, kind, phone });
  await service.remove(kind, branchId, tenantId, phone);
  successResponse(res, 'Image removed successfully', { kind, removed: true });
});

module.exports = {
  list:   [validateQuery(branchQuerySchema), list],
  get:    [validateParams(kindParamSchema), validateQuery(branchQuerySchema), get],
  put:    [validateQuery(branchQuerySchema), validateBody(putSchema), put],
  remove: [validateParams(kindParamSchema), validateQuery(branchQuerySchema), remove],
};
