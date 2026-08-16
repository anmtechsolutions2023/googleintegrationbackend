// src/modules/ledger/ledger.controller.js
const readService = require('./ledger.read.service');
const ledgerService = require('./ledger.service');
const { asyncHandler } = require('../../utils/controllerHelper');
const { successResponse, paginatedResponse } = require('../../utils/responseHelper');
const { validateQuery, validateBody, validateParams } = require('../../middleware/validation');
const {
  listQuerySchema, refundSchema, reportQuerySchema, uuidParamSchema,
} = require('./ledger.schemas');
const { withTransaction } = require('../../utils/dbHelper');
const reportService = require('./ledger.report.service');

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

// ── Reports ──────────────────────────────────────────────────────────────────
// Every one takes the same query contract, so the timeframe handling is written
// once. `report` builds the handler; the exported arrays only differ in which
// service function they call.
const report = (fn, message) =>
  asyncHandler(async (req, res) => {
    const data = await fn(req.validatedQuery, req.user.tid);
    successResponse(res, message, data);
  });

module.exports = {
  list: [validateQuery(listQuerySchema), list],
  getOne: [validateParams(uuidParamSchema), getOne],
  refund: [validateParams(uuidParamSchema), validateBody(refundSchema), refund],

  salesReport: [validateQuery(reportQuerySchema), report(reportService.salesReport, 'Sales report retrieved')],
  productReport: [validateQuery(reportQuerySchema), report(reportService.productReport, 'Product report retrieved')],
  pendingReport: [validateQuery(reportQuerySchema), report(reportService.pendingReport, 'Pending report retrieved')],
  tenderReport: [validateQuery(reportQuerySchema), report(reportService.tenderReport, 'Tender report retrieved')],
  cashFlowReport: [validateQuery(reportQuerySchema), report(reportService.cashFlowReport, 'Cash flow report retrieved')],
  expenseReport: [validateQuery(reportQuerySchema), report(reportService.expenseReport, 'Expense report retrieved')],
  overviewReport: [validateQuery(reportQuerySchema), report(reportService.overviewReport, 'Finance overview retrieved')],
  venueReport: [validateQuery(reportQuerySchema), report(reportService.venueReport, 'Venue report retrieved')],
  discountReport: [validateQuery(reportQuerySchema), report(reportService.discountReport, 'Discount report retrieved')],
};
