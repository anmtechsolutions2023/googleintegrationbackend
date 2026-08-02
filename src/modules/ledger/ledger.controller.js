// src/modules/ledger/ledger.controller.js
const readService = require('./ledger.read.service');
const ledgerService = require('./ledger.service');
const { asyncHandler } = require('../../utils/controllerHelper');
const { successResponse, paginatedResponse } = require('../../utils/responseHelper');
const { validateQuery, validateBody, validateParams } = require('../../middleware/validation');
const { listQuerySchema, refundSchema, uuidParamSchema } = require('./ledger.schemas');
const { withTransaction } = require('../../utils/dbHelper');

const list = asyncHandler(async (req, res) => {
  const { page, limit, ...filters } = req.validatedQuery;
  const result = await readService.listDocuments(filters, page, limit, req.user.tid);
  paginatedResponse(res, result.data, result.pagination, 'Ledger documents retrieved');
});

const getOne = asyncHandler(async (req, res) => {
  const doc = await readService.getDocument(req.params.id, req.user.tid);
  successResponse(res, 'Ledger document retrieved', doc);
});

// Whole-document reversal. Nothing is deleted: the original stands and a
// reversing tender is written beside it.
const refund = asyncHandler(async (req, res) => {
  const result = await withTransaction((conn) =>
    ledgerService.refundSale(
      conn, req.params.id, req.validatedBody.Reason, req.user.tid, req.user.email,
    ));
  successResponse(res, 'Document refunded', result);
});

module.exports = {
  list: [validateQuery(listQuerySchema), list],
  getOne: [validateParams(uuidParamSchema), getOne],
  refund: [validateParams(uuidParamSchema), validateBody(refundSchema), refund],
};
