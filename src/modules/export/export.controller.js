// src/modules/export/export.controller.js
const { asyncHandler } = require('../../utils/controllerHelper');
const { successResponse } = require('../../utils/responseHelper');
const { captureAudit } = require('../../utils/logger');
const { HttpError } = require('../../middleware/errorHandler');
const MESSAGES = require('../../config/messages');
const { AUDIT_CATEGORIES, STATUSES } = require('../../config/constants');
const { keyParam } = require('./export.schemas');
const catalogue = require('./export.catalogue');
const service = require('./export.service');

/** Sends a file. The name is exposed so a browser client can read it. */
const sendFile = (res, { fileName, body, contentType }) => {
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).send(body);
};

const keyOf = (req) => {
  const { error, value } = keyParam.validate(req.params.key);
  if (error) throw new HttpError(MESSAGES.ERROR.EXPORT_NOT_FOUND, MESSAGES.HTTP_STATUS.NOT_FOUND);
  return value;
};

/**
 * The audit row for a download. Personal data is logged at WARN: who took the
 * customer list, and whether the mobiles were in it, is the question an owner
 * asks after a leak, and WARN is what the audit screen filters on.
 */
const audit = (req, label, details, pii) => captureAudit(
  req, req.user.tid, req.user.phone, `Exported ${label}`, STATUSES.SUCCESS,
  AUDIT_CATEGORIES.REPORTS, pii ? 'WARN' : 'INFO', null, details,
);

/** GET / — the exports this person may take. */
const list = asyncHandler(async (req, res) => {
  successResponse(res, 'Exports retrieved', {
    exports: catalogue.visibleTo(req.user.scopes),
    canUnmask: catalogue.canUnmask(req.user.scopes),
  });
});

/** GET /:key/preview — row count, file name and columns, before downloading. */
const preview = asyncHandler(async (req, res) => {
  successResponse(res, 'Export preview', await service.preview(keyOf(req), req.query, req.user));
});

/** GET /:key — the CSV. */
const download = asyncHandler(async (req, res) => {
  const out = await service.run(keyOf(req), req.query, req.user);
  await audit(req, out.def.label, out.details, out.def.pii);
  sendFile(res, { fileName: out.fileName, body: out.csv, contentType: 'text/csv; charset=utf-8' });
});

/** GET /bundle — every Insights report for the period, zipped. */
const bundle = asyncHandler(async (req, res) => {
  const out = await service.bundle(req.query, req.user);
  await audit(req, 'reports bundle', out.details, false);
  sendFile(res, { fileName: out.fileName, body: out.buffer, contentType: 'application/zip' });
});

module.exports = { list: [list], preview: [preview], download: [download], bundle: [bundle] };
