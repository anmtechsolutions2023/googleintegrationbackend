// src/modules/ledger/ledger.controller.js
const readService = require('./ledger.read.service');
const ledgerService = require('./ledger.service');
const { asyncHandler } = require('../../utils/controllerHelper');
const { successResponse, paginatedResponse, createdResponse } = require('../../utils/responseHelper');
const { validateQuery, validateBody, validateParams } = require('../../middleware/validation');
const {
  listQuerySchema, returnsListQuerySchema, refundSchema, returnSchema, settlementSchema,
  reportQuerySchema, uuidParamSchema,
} = require('./ledger.schemas');
const { withTransaction } = require('../../utils/dbHelper');
const reportService = require('./ledger.report.service');
const returnsService = require('./ledger.returns.service');

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
      conn, req.params.id, req.validatedBody.Reason, req.user.tid, req.user.phone,
    ));
  successResponse(res, 'Document refunded', result);
});

/**
 * A PARTIAL return: selected lines, in the quantities that actually came back.
 *
 * A full refund is this with no line selection, which is why POST /refund above
 * now delegates to the same machinery rather than owning a second one.
 */
const createReturn = asyncHandler(async (req, res) => {
  const result = await withTransaction(async (conn) => {
    const note = await returnsService.createReturnTx(
      conn,
      { saleLogId: req.params.id, ...req.validatedBody },
      req.user.tid, req.user.phone,
    );
    // A replay returns the note that already exists and must NOT re-run the
    // downstream work — that would claw points back a second time.
    if (!note.duplicate) {
      await returnsService.applyDownstreamTx(conn, note, req.user.tid, req.user.phone);
    }
    const { _context, ...clean } = note;
    return clean;
  });
  createdResponse(res, 'Return recorded', result);
});

/**
 * The returns register — every credit note, filtered however you remember it.
 *
 * Paginated like the ledger list, but carries TOTALS for the whole filtered
 * set alongside the page: "₹6,240 returned this month" must not change when
 * somebody turns the page.
 */
const listReturns_ = asyncHandler(async (req, res) => {
  const { page, limit, ...filters } = req.validatedQuery;
  const result = await readService.listReturns(filters, page, limit, req.user.tid);
  res.status(200).json({
    success: true,
    message: 'Returns retrieved',
    data: result.data,
    totals: result.totals,
    pagination: result.pagination,
  });
});

/** Every credit note raised against one sale. */
const listReturns = asyncHandler(async (req, res) => {
  const data = await readService.listReturnsForSale(req.params.id, req.user.tid);
  successResponse(res, 'Returns retrieved', data);
});

/**
 * Money owed but not yet handed back.
 *
 * The operational worklist. Today every refund is executed at the till so this
 * is usually empty; it is the report that matters most the moment a payment
 * gateway makes a refund something that can be pending or fail.
 */
const settlementQueue = asyncHandler(async (req, res) => {
  const data = await readService.pendingSettlements(req.user.tid);
  successResponse(res, 'Pending refund settlements retrieved', data);
});

/** Mark a refund as actually paid out — a human today, a gateway later. */
const setSettlement = asyncHandler(async (req, res) => {
  const data = await readService.setSettlementStatus(
    req.params.id, req.validatedBody, req.user.tid, req.user.phone,
  );
  successResponse(res, 'Refund settlement updated', data);
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
  createReturn: [validateParams(uuidParamSchema), validateBody(returnSchema), createReturn],
  listReturns: [validateParams(uuidParamSchema), listReturns],
  returnsRegister: [validateQuery(returnsListQuerySchema), listReturns_],
  settlementQueue: [settlementQueue],
  setSettlement: [validateParams(uuidParamSchema), validateBody(settlementSchema), setSettlement],
  returnReasonsReport: [validateQuery(reportQuerySchema), report(reportService.returnReasonsReport, 'Return reasons report retrieved')],
  returnProductReport: [validateQuery(reportQuerySchema), report(reportService.returnProductReport, 'Product return report retrieved')],

  salesReport: [validateQuery(reportQuerySchema), report(reportService.salesReport, 'Sales report retrieved')],
  productReport: [validateQuery(reportQuerySchema), report(reportService.productReport, 'Product report retrieved')],
  pendingReport: [validateQuery(reportQuerySchema), report(reportService.pendingReport, 'Pending report retrieved')],
  tenderReport: [validateQuery(reportQuerySchema), report(reportService.tenderReport, 'Tender report retrieved')],
  cashFlowReport: [validateQuery(reportQuerySchema), report(reportService.cashFlowReport, 'Cash flow report retrieved')],
  expenseReport: [validateQuery(reportQuerySchema), report(reportService.expenseReport, 'Expense report retrieved')],
  overviewReport: [validateQuery(reportQuerySchema), report(reportService.overviewReport, 'Finance overview retrieved')],
  venueReport: [validateQuery(reportQuerySchema), report(reportService.venueReport, 'Venue report retrieved')],
  channelReport: [validateQuery(reportQuerySchema), report(reportService.channelReport, 'Channel report retrieved')],
  discountReport: [validateQuery(reportQuerySchema), report(reportService.discountReport, 'Discount report retrieved')],
  // Customer reports. Ten reports covered what was sold; these three cover who
  // bought it, how often, and who has stopped.
  customerReport: [validateQuery(reportQuerySchema), report(reportService.customerReport, 'Customer report retrieved')],
  visitPatternReport: [validateQuery(reportQuerySchema), report(reportService.visitPatternReport, 'Visit pattern retrieved')],
  lapsedReport: [validateQuery(reportQuerySchema), report(reportService.lapsedReport, 'Lapsed customers retrieved')],
};
