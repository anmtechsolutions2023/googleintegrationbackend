// src/modules/gstexport/gstexport.controller.js
const { asyncHandler } = require('../../utils/controllerHelper');
const { successResponse } = require('../../utils/responseHelper');
const { validateQuery, validateBody } = require('../../middleware/validation');
const { reportQuerySchema } = require('../ledger/ledger.schemas');
const { packQuerySchema, withoutGstQuerySchema, filingSchema } = require('./gstexport.schemas');
const service = require('./gstexport.service');

/** Sends a file. The name is exposed so a browser client can read it. */
const sendFile = (res, { fileName, body, contentType }) => {
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).send(body);
};

const readiness = asyncHandler(async (req, res) => {
  successResponse(res, 'GST export readiness', await service.readiness(req.validatedQuery, req.user.tid));
});

const pack = asyncHandler(async (req, res) => {
  const { fileName, buffer } = await service.pack(req.validatedQuery, req.user.tid);
  sendFile(res, { fileName, body: buffer, contentType: 'application/zip' });
});

const withoutGst = asyncHandler(async (req, res) => {
  const { fileName, csv } = await service.withoutGstCsv(req.validatedQuery, req.user.tid);
  sendFile(res, { fileName, body: csv, contentType: 'text/csv; charset=utf-8' });
});

const recordFiling = asyncHandler(async (req, res) => {
  successResponse(res, 'Filing recorded', await service.recordFiling(req.validatedBody, req.user.tid, req.user.phone));
});

const split = asyncHandler(async (req, res) => {
  successResponse(res, 'GST split report retrieved', await service.splitReport(req.validatedQuery, req.user.tid));
});

module.exports = {
  readiness: [validateQuery(packQuerySchema), readiness],
  pack: [validateQuery(packQuerySchema), pack],
  withoutGst: [validateQuery(withoutGstQuerySchema), withoutGst],
  recordFiling: [validateBody(filingSchema), recordFiling],
  split: [validateQuery(reportQuerySchema), split],
};
