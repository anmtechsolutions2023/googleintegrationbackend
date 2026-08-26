// src/modules/posportal/posportal.controller.js
// Controller layer for POS Portals — HTTP request/response handling.

const service = require('./posportal.service');
const branchService = require('./posportal.branch.service');
const listingService = require('./posportal.listing.service');
const dispatchService = require('./posportal.dispatch.service');
const { asyncHandler } = require('../../utils/controllerHelper');
const {
  successResponse,
  paginatedResponse,
  createdResponse,
  noContentResponse,
} = require('../../utils/responseHelper');
const {
  validateBody,
  validateQuery,
  validateParams,
} = require('../../middleware/validation');
const {
  createSchema,
  updateSchema,
  credentialSchema,
  branchCreateSchema,
  branchUpdateSchema,
  setOnlineSchema,
  listingCreateSchema,
  listingUpdateSchema,
  bulkAvailabilitySchema,
  paginationSchema,
  uuidParamSchema,
} = require('./posportal.schemas');
const { logger } = require('../../utils/logger');

// ── The portal master ───────────────────────────────────────────────────────

const getAll = asyncHandler(async (req, res) => {
  const { tid: tenantId } = req.user;
  const { page, limit, expand } = req.query;
  logger.info('PosPortal.getAll called', { tenantId, page, limit });
  const result = await service.getAll(tenantId, page, limit, expand);
  paginatedResponse(res, result.data, result.pagination, 'POS Portals retrieved successfully');
});

const getById = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { tid: tenantId } = req.user;
  const record = await service.getById(id, tenantId);
  successResponse(res, record, 'POS Portal retrieved successfully');
});

const create = asyncHandler(async (req, res) => {
  const { tid: tenantId, email } = req.user;
  logger.info('PosPortal.create called', { tenantId, email });
  const created = await service.create(req.body, tenantId, email);
  createdResponse(res, created, 'POS Portal created successfully');
});

const update = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { tid: tenantId, email } = req.user;
  const updated = await service.update(id, req.body, tenantId, email);
  successResponse(res, updated, 'POS Portal updated successfully');
});

const deleteById = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { tid: tenantId } = req.user;
  await service.remove(id, tenantId);
  noContentResponse(res, 'POS Portal deleted successfully');
});

// Write-only. There is deliberately no GET counterpart: the response is a
// receipt that the portal is configured, never the secrets themselves.
const saveCredential = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { tid: tenantId, email } = req.user;
  logger.info('PosPortal.saveCredential called', { portalId: id, tenantId, email });
  const result = await service.saveCredential(id, req.body, tenantId, email);
  successResponse(res, result, 'Portal credentials saved');
});

// ── Store mappings ──────────────────────────────────────────────────────────

const listBranches = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { tid: tenantId } = req.user;
  const rows = await branchService.listByPortal(id, tenantId);
  successResponse(res, rows, 'Portal branches retrieved successfully');
});

const createBranch = asyncHandler(async (req, res) => {
  const { tid: tenantId, email } = req.user;
  const created = await branchService.create(req.body, tenantId, email);
  createdResponse(res, created, 'Portal branch mapping created successfully');
});

const updateBranch = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { tid: tenantId, email } = req.user;
  const updated = await branchService.update(id, req.body, tenantId, email);
  successResponse(res, updated, 'Portal branch mapping updated successfully');
});

const deleteBranch = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { tid: tenantId } = req.user;
  await branchService.remove(id, tenantId);
  noContentResponse(res, 'Portal branch mapping deleted successfully');
});

// The kill switch, as its own endpoint. The person reaching for it is in a
// rush; a full-row PUT from a stale form would roll back whatever else changed.
const setOnline = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { tid: tenantId, email } = req.user;
  logger.info('PosPortal.setOnline called', { id, tenantId, isOnline: req.body.IsOnline });
  const result = await branchService.setOnline(id, req.body, tenantId, email);
  successResponse(res, result, req.body.IsOnline ? 'Now accepting orders' : 'Orders paused');
});

// ── Listings ────────────────────────────────────────────────────────────────

const listListings = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { tid: tenantId } = req.user;
  const rows = await listingService.listByPortal(id, tenantId);
  successResponse(res, rows, 'Portal listings retrieved successfully');
});

const createListing = asyncHandler(async (req, res) => {
  const { tid: tenantId, email } = req.user;
  const created = await listingService.create(req.body, tenantId, email);
  createdResponse(res, created, 'Portal listing created successfully');
});

const updateListing = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { tid: tenantId, email } = req.user;
  const updated = await listingService.update(id, req.body, tenantId, email);
  successResponse(res, updated, 'Portal listing updated successfully');
});

const deleteListing = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { tid: tenantId } = req.user;
  await listingService.remove(id, tenantId);
  noContentResponse(res, 'Portal listing deleted successfully');
});

const setAvailability = asyncHandler(async (req, res) => {
  const { tid: tenantId, email } = req.user;
  logger.info('PosPortal.setAvailability called', {
    tenantId, count: req.body.ListingIds?.length, available: req.body.Available,
  });
  const result = await listingService.setAvailabilityBulk(req.body, tenantId, email);
  successResponse(res, result, 'Availability updated');
});

// Publish the catalogue to the portal and RECORD what it accepted.
const publishMenu = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { tid: tenantId, email } = req.user;
  logger.info('PosPortal.publishMenu called', { portalId: id, tenantId, email });
  const result = await dispatchService.publishMenu(id, tenantId, email);
  successResponse(res, result, 'Menu publish attempted');
});

module.exports = {
  getAll: [validateQuery(paginationSchema), getAll],
  getById: [validateParams(uuidParamSchema), getById],
  create: [validateBody(createSchema), create],
  update: [validateParams(uuidParamSchema), validateBody(updateSchema), update],
  deleteById: [validateParams(uuidParamSchema), deleteById],
  saveCredential: [validateParams(uuidParamSchema), validateBody(credentialSchema), saveCredential],

  listBranches: [validateParams(uuidParamSchema), listBranches],
  createBranch: [validateBody(branchCreateSchema), createBranch],
  updateBranch: [validateParams(uuidParamSchema), validateBody(branchUpdateSchema), updateBranch],
  deleteBranch: [validateParams(uuidParamSchema), deleteBranch],
  setOnline: [validateParams(uuidParamSchema), validateBody(setOnlineSchema), setOnline],

  listListings: [validateParams(uuidParamSchema), listListings],
  createListing: [validateBody(listingCreateSchema), createListing],
  updateListing: [validateParams(uuidParamSchema), validateBody(listingUpdateSchema), updateListing],
  deleteListing: [validateParams(uuidParamSchema), deleteListing],
  setAvailability: [validateBody(bulkAvailabilitySchema), setAvailability],
  publishMenu: [validateParams(uuidParamSchema), publishMenu],
};
