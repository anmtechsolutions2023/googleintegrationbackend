// src/modules/menu/menu.controller.js
const { asyncHandler } = require('../../utils/controllerHelper');
const { successResponse, createdResponse, noContentResponse } = require('../../utils/responseHelper');
const { validateBody, validateParams } = require('../../middleware/validation');
const { captureAudit } = require('../../utils/logger');
const { AUDIT_CATEGORIES, STATUSES } = require('../../config/constants');
const { dishSchema, importSchema, pricesSchema, bulkSchema, photoSchema, itemIdParam } = require('./menu.schemas');
const service = require('./menu.service');
const menuImport = require('./menu.import');

const body = (req) => req.validatedBody ?? req.body;

const options = asyncHandler(async (req, res) => {
  successResponse(res, 'Menu options retrieved', await service.options(req.user.tid));
});

const list = asyncHandler(async (req, res) => {
  successResponse(res, 'Dishes retrieved', await service.listDishes(req.user.tid));
});

const getOne = asyncHandler(async (req, res) => {
  successResponse(res, 'Dish retrieved', await service.getDish(req.params.itemId, req.user.tid));
});

const create = asyncHandler(async (req, res) => {
  createdResponse(res, 'Dish saved', await service.save(body(req), null, req.user.tid, req.user.phone));
});

const update = asyncHandler(async (req, res) => {
  successResponse(res, 'Dish saved', await service.save(body(req), req.params.itemId, req.user.tid, req.user.phone));
});

/** A one-line account of a file, for the audit trail. */
const importDetails = (r) => [
  `${r.summary.new} new`, `${r.summary.changed} changed`, `${r.summary.unchanged} unchanged`, `${r.summary.errors} errors`,
  r.addons && (r.addons.created || r.addons.updated) ? `${r.addons.created + r.addons.updated} add-ons` : null,
  r.hours && r.hours.windows !== undefined ? `${r.hours.windows} hour windows` : null,
].filter(Boolean).join(' · ');

const importPreview = asyncHandler(async (req, res) => {
  successResponse(res, 'Menu file checked — nothing was written',
    await menuImport.run(body(req), { dryRun: true }, req.user.tid, req.user.phone));
});

const importApply = asyncHandler(async (req, res) => {
  const result = await menuImport.run(body(req), { dryRun: false }, req.user.tid, req.user.phone);
  await captureAudit(req, req.user.tid, req.user.phone, 'Menu file imported', STATUSES.SUCCESS,
    AUDIT_CATEGORIES.MASTER_DATA, 'INFO', null, importDetails(result));
  successResponse(res, 'Menu file imported', result);
});

const prices = asyncHandler(async (req, res) => {
  successResponse(res, 'Prices retrieved', await service.priceGrid(req.user.tid));
});

const savePrices = asyncHandler(async (req, res) => {
  const { changes } = body(req);
  const result = await service.savePrices(changes, req.user.tid, req.user.phone);
  await captureAudit(req, req.user.tid, req.user.phone, 'Menu prices changed', STATUSES.SUCCESS,
    AUDIT_CATEGORIES.MASTER_DATA, 'INFO', null, `${changes.length} changes on ${result.updated} dishes`);
  successResponse(res, 'Prices saved', result);
});

const bulk = asyncHandler(async (req, res) => {
  successResponse(res, 'Dishes updated', await service.bulk(body(req), req.user.tid, req.user.phone));
});

const getPhoto = asyncHandler(async (req, res) => {
  const p = await service.getPhoto(req.params.itemId, req.user.tid);
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Cache-Control', 'private, max-age=0, must-revalidate');
  successResponse(res, 'Photo retrieved', {
    mimeType: p.MimeType, width: p.Width, height: p.Height, byteSize: p.ByteSize, updatedOn: p.UpdatedOn,
    dataUri: `data:${p.MimeType};base64,${Buffer.from(p.Bytes).toString('base64')}`,
  });
});

const putPhoto = asyncHandler(async (req, res) => {
  createdResponse(res, 'Photo saved', await service.putPhoto(req.params.itemId, body(req).dataUri, req.user.tid, req.user.phone));
});

const deletePhoto = asyncHandler(async (req, res) => {
  await service.deletePhoto(req.params.itemId, req.user.tid);
  noContentResponse(res);
});

const id = validateParams(itemIdParam);

module.exports = {
  options: [options],
  list: [list],
  getOne: [id, getOne],
  create: [validateBody(dishSchema), create],
  update: [id, validateBody(dishSchema), update],
  importPreview: [validateBody(importSchema), importPreview],
  importApply: [validateBody(importSchema), importApply],
  prices: [prices],
  savePrices: [validateBody(pricesSchema), savePrices],
  bulk: [validateBody(bulkSchema), bulk],
  getPhoto: [id, getPhoto],
  putPhoto: [id, validateBody(photoSchema), putPhoto],
  deletePhoto: [id, deletePhoto],
};
