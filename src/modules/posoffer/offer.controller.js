// src/modules/posoffer/offer.controller.js
// Controller layer for campaigns and offers — HTTP request/response handling.

const campaignService = require('./campaign.service');
const offerService = require('./offer.service');
const reportService = require('./campaign.report.service');
const engine = require('./offer.engine.service');
const { asyncHandler } = require('../../utils/controllerHelper');
const { successResponse } = require('../../utils/responseHelper');
const { validateBody, validateParams } = require('../../middleware/validation');
const {
  idParamSchema, campaignSchema, campaignUpdateSchema, statusSchema,
  offerSchema, offerUpdateSchema, previewSchema,
} = require('./offer.schemas');
const { logger } = require('../../utils/logger');

// ── Campaigns ────────────────────────────────────────────────────────────────
const listCampaigns = asyncHandler(async (req, res) => {
  const data = await campaignService.getAll(req.user.tid);
  successResponse(res, data, 'Campaigns retrieved successfully');
});

const getCampaign = asyncHandler(async (req, res) => {
  const data = await campaignService.getById(req.params.id, req.user.tid);
  successResponse(res, data, 'Campaign retrieved successfully');
});

const createCampaign = asyncHandler(async (req, res) => {
  const { tid: tenantId, phone } = req.user;
  logger.info('Campaign.create called', { tenantId, phone });
  const data = await campaignService.create(req.body, tenantId, phone);
  res.status(201).json({ success: true, message: 'Campaign created successfully', data });
});

const updateCampaign = asyncHandler(async (req, res) => {
  const { tid: tenantId, phone } = req.user;
  const data = await campaignService.update(req.params.id, req.body, tenantId, phone);
  successResponse(res, data, 'Campaign updated successfully');
});

const setCampaignStatus = asyncHandler(async (req, res) => {
  const { tid: tenantId, phone } = req.user;
  const data = await campaignService.setStatus(req.params.id, req.body.Status, tenantId, phone);
  successResponse(res, data, 'Campaign status updated successfully');
});

const deleteCampaign = asyncHandler(async (req, res) => {
  const { tid: tenantId, phone } = req.user;
  const data = await campaignService.remove(req.params.id, tenantId, phone);
  successResponse(res, data, 'Campaign deleted successfully');
});

const campaignReport = asyncHandler(async (req, res) => {
  const data = await reportService.forCampaign(req.params.id, req.user.tid);
  successResponse(res, data, 'Campaign report retrieved successfully');
});

// ── Offers ───────────────────────────────────────────────────────────────────
const listOffers = asyncHandler(async (req, res) => {
  const data = await offerService.getByCampaign(req.params.id, req.user.tid);
  successResponse(res, data, 'Offers retrieved successfully');
});

const createOffer = asyncHandler(async (req, res) => {
  const { tid: tenantId, phone } = req.user;
  const data = await offerService.create(req.params.id, req.body, tenantId, phone);
  res.status(201).json({ success: true, message: 'Offer created successfully', data });
});

const updateOffer = asyncHandler(async (req, res) => {
  const { tid: tenantId, phone } = req.user;
  const data = await offerService.update(req.params.id, req.body, tenantId, phone);
  successResponse(res, data, 'Offer updated successfully');
});

const deleteOffer = asyncHandler(async (req, res) => {
  const { tid: tenantId, phone } = req.user;
  const data = await offerService.remove(req.params.id, tenantId, phone);
  successResponse(res, data, 'Offer deleted successfully');
});

// ── The till's preview ───────────────────────────────────────────────────────
/**
 * Deliberately NOT the authority. The settle path re-runs the same evaluation
 * inside its own transaction and writes the discounts itself, so a till that
 * never calls this still produces the same bill. It exists so a cashier can SEE
 * what is about to happen.
 */
const previewOffers = asyncHandler(async (req, res) => {
  const { lines, branchId, posCustomerId } = req.body;
  const billAmount = lines.reduce(
    (s, l) => s + (Number(l.unitAmount || 0) * Number(l.quantity || 0)), 0,
  );
  const data = await engine.preview({ lines, billAmount, branchId, posCustomerId }, req.user.tid);
  successResponse(res, data, 'Offers evaluated');
});

module.exports = {
  listCampaigns: [listCampaigns],
  getCampaign: [validateParams(idParamSchema), getCampaign],
  createCampaign: [validateBody(campaignSchema), createCampaign],
  updateCampaign: [validateParams(idParamSchema), validateBody(campaignUpdateSchema), updateCampaign],
  setCampaignStatus: [validateParams(idParamSchema), validateBody(statusSchema), setCampaignStatus],
  deleteCampaign: [validateParams(idParamSchema), deleteCampaign],
  campaignReport: [validateParams(idParamSchema), campaignReport],
  listOffers: [validateParams(idParamSchema), listOffers],
  createOffer: [validateParams(idParamSchema), validateBody(offerSchema), createOffer],
  updateOffer: [validateParams(idParamSchema), validateBody(offerUpdateSchema), updateOffer],
  deleteOffer: [validateParams(idParamSchema), deleteOffer],
  previewOffers: [validateBody(previewSchema), previewOffers],
};
