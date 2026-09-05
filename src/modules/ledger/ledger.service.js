// src/modules/ledger/ledger.service.js
// Posts a settled POS bill as an accounting document.
//
//   transactiondetaillog          the Sale — numbered, dated, totalled
//     └── transactionitemdetail   lines, with variants and per-line tax
//     └── paymentdetail           the settlement
//           └── paymentbreakup    one row per tender (Cash / Card / UPI …)
//                 └── paymentmodetransactiondetail   the instrument + RefNo
//
// Four properties make this a ledger rather than a table dump:
//   * numbered   — gap-free, issued under a row lock (transactionNumber.service)
//   * immutable  — settled documents are never edited, only reversed
//   * auditable  — every status move is checked against a permitted transition
//                  and recorded in transactiontypeconversionmapper
//   * balanced   — invoiced totals (on the log) are separate from collected
//                  amounts (on paymentdetail), so partial payment is expressible

const { v4: uuidv4 } = require('uuid');
const { QUERIES } = require('../../config/constants');
const { HttpError } = require('../../middleware/errorHandler');
// The one date authority, shared with whatever reads these dates back.
const { businessDate } = require('../../utils/dateRange');
const MESSAGES = require('../../config/messages');
const { LEDGER, POS_BILL_STATUS } = require('../../config/constants');
const { toMinor, fromMinor } = require('../../utils/taxCalculator');
const numberService = require('./transactionNumber.service');
const contactResolver = require('./contactResolver.service');
const { logger } = require('../../utils/logger');
const customerStats = require('../poscustomer/poscustomer.stats.service');
const loyalty = require('../loyalty/loyalty.service');
// Shared with the returns service. Lifted out so a credit note does not have to
// import the sale posting it reverses — see ledger.primitives.js.
const { requireMaster, applyRoundOff, transitionStatus } = require('./ledger.primitives');
const returnsService = require('./ledger.returns.service');

const toJson = (v) => (v == null ? null : typeof v === 'string' ? v : JSON.stringify(v));

/**
 * Resolves the tender's payment mode and the account the money lands in.
 *
 * Three things have to be true before money can be recorded: the mode exists,
 * electronic modes carry a reference, and the mode knows which account it feeds.
 * The last one is what turns a tender into a cash movement — a mode with no
 * account would silently make its takings invisible to cash flow.
 *
 * @returns {Promise<{Id:string, Type:string, DefaultAccountTypeBaseId:string}>}
 */
const resolveTenderMode = async (conn, tender, tenantId) => {
  const [modes] = await conn.execute(QUERIES.LEDGER.SELECT_PAYMENT_MODE, [
    tender.paymentModeId, tenantId,
  ]);
  if (!modes || modes.length === 0) {
    throw new HttpError(
      MESSAGES.ERROR.LEDGER_PAYMENT_MODE_UNKNOWN,
      MESSAGES.HTTP_STATUS.BAD_REQUEST,
    );
  }
  const mode = modes[0];

  // Card/UPI/Wallet must carry a reference or the takings cannot be reconciled.
  if (LEDGER.REF_REQUIRED_MODES.includes(mode.Type) && !tender.refNo) {
    throw new HttpError(
      MESSAGES.ERROR.LEDGER_REF_REQUIRED,
      MESSAGES.HTTP_STATUS.BAD_REQUEST,
    );
  }
  if (!mode.DefaultAccountTypeBaseId) {
    throw new HttpError(
      `${MESSAGES.ERROR.LEDGER_ACCOUNT_UNMAPPED}${mode.Type}.`,
      MESSAGES.HTTP_STATUS.BAD_REQUEST,
    );
  }
  return mode;
};

/**
 * Posts a priced bill to the ledger.
 *
 * @param {Object} conn - Open transaction connection (the caller owns it, so a
 *        failure anywhere rolls the whole document back).
 * @param {Object} input
 * @param {string} input.billId
 * @param {Object} input.totals - { SubTotal, TaxAmount, Discount, Total, TaxByComponent }
 * @param {Array} input.lines - Priced line snapshots from the bill's rounds.
 * @param {Array} input.tenders - [{ paymentModeId, amount, refNo?, comment? }]
 * @param {string|null} input.posCustomerId
 * @param {string|null} input.branchId
 * @param {string} tenantId
 * @param {string} userPhone
 * @returns {Promise<Object>} { transactionDetailLogId, transactionNo, status, roundOff, balanceDue }
 */
const postSaleFromBill = async (conn, input, tenantId, userPhone) => {
  const { billId, totals, lines, tenders = [], posCustomerId, branchId } = input;

  // ── Idempotency: a posted bill must never issue a second invoice ──────────
  const [billRows] = await conn.execute(QUERIES.LEDGER.SELECT_BILL_LEDGER_LINK, [billId, tenantId]);
  if (billRows && billRows.length > 0 && billRows[0].TransactionDetailLogId) {
    throw new HttpError(
      MESSAGES.ERROR.LEDGER_ALREADY_POSTED,
      MESSAGES.HTTP_STATUS.CONFLICT,
    );
  }

  // ── Masters ──────────────────────────────────────────────────────────────
  const saleType = await requireMaster(
    conn, QUERIES.LEDGER.SELECT_TYPE_BY_NAME, LEDGER.TYPE_POS_SALE, tenantId, 'transaction type',
  );
  const draft = await requireMaster(
    conn, QUERIES.LEDGER.SELECT_STATUS_BY_NAME, LEDGER.STATUS_DRAFT, tenantId, 'status',
  );
  const salesAccount = await requireMaster(
    conn, QUERIES.LEDGER.SELECT_ACCOUNT_BY_NAME, LEDGER.ACCOUNT_SALES, tenantId, 'account',
  );
  const configId = saleType.TransactionTypeConfigId;

  // ── Rounding (automatic, to the nearest rupee) ───────────────────────────
  const { roundedGross, roundOff } = applyRoundOff(totals.Total);

  // ── Customer ─────────────────────────────────────────────────────────────
  const customer = await contactResolver.resolveContactForPosCustomer(
    conn, posCustomerId, tenantId, userPhone,
  );

  // ── Number + header ──────────────────────────────────────────────────────
  const { transactionNo } = await numberService.issueNumber(conn, configId, tenantId, userPhone);
  const logId = uuidv4();

  await conn.execute(QUERIES.LEDGER.INSERT_LOG, [
    logId, tenantId, transactionNo, configId, saleType.Id, draft.Id, branchId ?? null,
    businessDate(),
    totals.SubTotal ?? 0, totals.TaxAmount ?? 0, totals.Discount ?? 0,
    roundOff, roundedGross, toJson(totals.TaxByComponent || []),
    customer.contactDetailId, customer.name, customer.mobile,
    null, userPhone, userPhone,
  ]);

  // ── Lines ────────────────────────────────────────────────────────────────
  // LineNo is what lets the same dish appear twice with different options.
  let lineNo = 0;
  let linesGrossMinor = 0;
  for (const line of lines) {
    lineNo += 1;
    // A line that cannot be posted fails the whole settle. Skipping it would
    // leave the header charging for something the document does not itemise —
    // silent omission is the one outcome a ledger must never have.
    if (!line.itemDetailId) {
      throw new HttpError(
        `${MESSAGES.ERROR.LEDGER_LINE_UNPOSTABLE}${line.name || `line ${lineNo}`}.`,
        MESSAGES.HTTP_STATUS.BAD_REQUEST,
      );
    }
    await conn.execute(QUERIES.LEDGER.INSERT_LINE, [
      uuidv4(), tenantId, logId, lineNo, line.itemDetailId,
      line.quantity ?? 1, line.costInfoId ?? null,
      line.unitAmount ?? null, line.basePrice ?? null, line.variantAmount ?? 0,
      line.netAmount ?? null, line.discountAmount ?? 0, line.itemDiscountAmount ?? 0,
      line.taxAmount ?? null, line.grossAmount ?? null,
      toJson(line.taxComponents || []), toJson(line.variants || []),
      line.name ? String(line.name).slice(0, 100) : null,
      userPhone, userPhone,
    ]);
    linesGrossMinor += toMinor(line.grossAmount ?? 0);
  }

  // The document must add up to its own lines. Round-off is a deliberate
  // adjustment to the payable, so it is excluded from the comparison; anything
  // else is a pricing bug and the sale is refused rather than mis-recorded.
  if (Math.abs(linesGrossMinor - toMinor(totals.Total ?? 0)) > 1) {
    throw new HttpError(
      MESSAGES.ERROR.LEDGER_TOTALS_MISMATCH,
      MESSAGES.HTTP_STATUS.BAD_REQUEST,
    );
  }

  // ── Settlement ───────────────────────────────────────────────────────────
  const tenderedMinor = tenders.reduce((sum, t) => sum + toMinor(t.amount), 0);
  const payableMinor = toMinor(roundedGross);
  // Over-tender is change, not revenue: only the payable share is recorded.
  const settledMinor = Math.min(tenderedMinor, payableMinor);
  const balanceDue = fromMinor(Math.max(0, payableMinor - tenderedMinor));
  const isFull = tenderedMinor >= payableMinor;

  const receivedType = await requireMaster(
    conn, QUERIES.LEDGER.SELECT_RECEIVED_TYPE_BY_NAME,
    isFull ? LEDGER.RECEIVED_FULL : LEDGER.RECEIVED_PARTIAL, tenantId, 'received type',
  );

  const paymentDetailId = uuidv4();
  await conn.execute(QUERIES.LEDGER.INSERT_PAYMENT_DETAIL, [
    paymentDetailId, tenantId, salesAccount.Id, logId,
    totals.Discount ?? 0, roundOff, fromMinor(settledMinor),
    totals.TaxAmount ?? 0, totals.SubTotal ?? 0,
    null, userPhone, userPhone,
  ]);

  // One paymentbreakup per tender, each with its own instrument row so a card
  // approval code or UPI reference stays attached to the money it belongs to.
  let remainingMinor = settledMinor;
  for (const tender of tenders) {
    const mode = await resolveTenderMode(conn, tender, tenantId);

    const pmtdId = uuidv4();
    await conn.execute(QUERIES.LEDGER.INSERT_PMTD, [
      pmtdId, tenantId, tender.paymentModeId, tender.refNo ?? null,
      tender.comment ?? null, userPhone, userPhone,
    ]);

    // Trim the final tender so the breakups sum to what was actually settled
    // rather than to what was handed over.
    const wanted = toMinor(tender.amount);
    const applied = Math.min(wanted, remainingMinor);
    remainingMinor -= applied;

    // Booked to the account the money LANDED IN (Cash / Bank / Wallet), not to
    // 'Sales'. This is what makes paymentbreakup a cash movement log: without
    // it every tender books to one account and cash flow is not computable.
    await conn.execute(QUERIES.LEDGER.INSERT_BREAKUP, [
      uuidv4(), tenantId, mode.DefaultAccountTypeBaseId, paymentDetailId, pmtdId,
      receivedType.Id, fromMinor(applied), null, userPhone, userPhone,
    ]);
  }

  // ── Status ───────────────────────────────────────────────────────────────
  const target = await requireMaster(
    conn, QUERIES.LEDGER.SELECT_STATUS_BY_NAME,
    isFull ? LEDGER.STATUS_SETTLED : LEDGER.STATUS_PARTIALLY_PAID, tenantId, 'status',
  );
  await transitionStatus(
    conn,
    {
      logId, configId, fromStatusId: draft.Id, toStatusId: target.Id,
      settledAt: isFull ? new Date() : null,
    },
    tenantId, userPhone,
  );

  await conn.execute(QUERIES.LEDGER.UPDATE_BILL_LEDGER_LINK, [
    logId, userPhone, billId, tenantId,
  ]);

  return {
    transactionDetailLogId: logId,
    transactionNo,
    status: isFull ? LEDGER.STATUS_SETTLED : LEDGER.STATUS_PARTIALLY_PAID,
    roundOff,
    payable: roundedGross,
    balanceDue,
  };
};

/**
 * Reverses a settled document, in full.
 *
 * ── Now a thin wrapper, deliberately ────────────────────────────────────────
 * This used to BE the refund: it moved the sale's own status SETTLED →
 * REFUNDED and mirrored every tender back. That worked for exactly one refund
 * of exactly the whole amount, and failed at the state machine on the second.
 *
 * The work now lives in ledger.returns.service.createReturnTx, which raises a
 * credit note against the sale instead of mutating it. A FULL refund is simply
 * that call with no line selection — "return everything still outstanding" —
 * so there is one implementation of returning goods rather than two that drift.
 *
 * The signature is unchanged and every existing caller keeps working. What
 * changes underneath: the sale is no longer mutated, so a document refunded
 * through this path can still be partially returned against afterwards if some
 * of it was left, and it no longer vanishes from revenue reports.
 *
 * @param {Object} conn - Open transaction connection.
 * @param {string} logId - The sale to reverse.
 * @param {string} reason - Free text, kept as the note on the credit note.
 * @returns {Promise<Object>} { transactionDetailLogId, status, creditNoteNo }
 */
const refundSale = async (conn, logId, reason, tenantId, userPhone) => {
  const result = await returnsService.createReturnTx(
    conn,
    { saleLogId: logId, lines: [], note: reason },
    tenantId, userPhone,
  );
  await returnsService.applyDownstreamTx(conn, result, tenantId, userPhone);

  return {
    // The SALE's id, as before — callers use this to identify what was refunded.
    transactionDetailLogId: logId,
    status: LEDGER.STATUS_REFUNDED,
    // The credit note that actually carries the reversal.
    creditNoteId: result.transactionDetailLogId,
    creditNoteNo: result.transactionNo,
    refundedAmount: result.grossAmount,
    refundState: result.refundState,
  };
};

/**
 * Posts an approved expense as an accounting document.
 *
 * Deliberately the same machinery as a sale — numbered document, status
 * whitelist, payment rows — with one sign flipped: the `paymentbreakup` amount
 * is NEGATIVE. That single choice is what lets daily cash flow be one SUM over
 * one table instead of a reconciliation between a sales ledger and an expense
 * list.
 *
 * An expense has no `transactionitemdetail` lines: the category is its analysis
 * axis, and inventing a line item per expense would pollute product analytics.
 *
 * @param {Object} conn - Open transaction connection (caller owns it).
 * @param {Object} input - { expenseId, amount, categoryId, paymentModeId, description, branchId, expenseDate }
 * @param {string} tenantId
 * @param {string} userPhone
 * @returns {Promise<Object>} { transactionDetailLogId, transactionNo, status }
 */
const postExpense = async (conn, input, tenantId, userPhone) => {
  const {
    expenseId, amount, categoryId, paymentModeId, description, branchId, expenseDate,
  } = input;

  // ── Idempotency: one expense, one document ───────────────────────────────
  const [rows] = await conn.execute(QUERIES.LEDGER.SELECT_EXPENSE_LEDGER_LINK, [expenseId, tenantId]);
  if (rows && rows.length > 0 && rows[0].TransactionDetailLogId) {
    throw new HttpError(
      MESSAGES.ERROR.EXPENSE_ALREADY_POSTED,
      MESSAGES.HTTP_STATUS.CONFLICT,
    );
  }

  // ── Masters ──────────────────────────────────────────────────────────────
  const expenseType = await requireMaster(
    conn, QUERIES.LEDGER.SELECT_TYPE_BY_NAME, LEDGER.TYPE_EXPENSE, tenantId, 'transaction type',
  );
  const draft = await requireMaster(
    conn, QUERIES.LEDGER.SELECT_STATUS_BY_NAME, LEDGER.STATUS_DRAFT, tenantId, 'status',
  );
  const settled = await requireMaster(
    conn, QUERIES.LEDGER.SELECT_STATUS_BY_NAME, LEDGER.STATUS_SETTLED, tenantId, 'status',
  );
  const paymentType = await requireMaster(
    conn, QUERIES.LEDGER.SELECT_RECEIVED_TYPE_BY_NAME, LEDGER.RECEIVED_PAYMENT, tenantId, 'received type',
  );
  const configId = expenseType.TransactionTypeConfigId;

  // The expense account the spend is booked against, per category.
  const [categories] = await conn.execute(
    QUERIES.LEDGER.SELECT_EXPENSE_CATEGORY_ACCOUNT, [categoryId, tenantId],
  );
  const expenseAccountId = categories?.[0]?.AccountTypeBaseId
    || (await requireMaster(
      conn, QUERIES.LEDGER.SELECT_ACCOUNT_BY_NAME, LEDGER.ACCOUNT_EXPENSES, tenantId, 'account',
    )).Id;

  // Which account the money LEFT.
  const mode = await resolveTenderMode(conn, { paymentModeId }, tenantId);

  // ── Number + header ──────────────────────────────────────────────────────
  const { transactionNo } = await numberService.issueNumber(conn, configId, tenantId, userPhone);
  const logId = uuidv4();
  const gross = Number(amount) || 0;

  // An expense carries no tax breakdown and no customer — it is a payment, not
  // a sale. Amount sits in Net and Gross so the two agree.
  await conn.execute(QUERIES.LEDGER.INSERT_LOG, [
    logId, tenantId, transactionNo, configId, expenseType.Id, draft.Id, branchId ?? null,
    businessDate(expenseDate),
    gross, 0, 0, 0, gross, toJson([]),
    null, null, null,
    description ? String(description).slice(0, 500) : null, userPhone, userPhone,
  ]);

  // ── Payment ──────────────────────────────────────────────────────────────
  const paymentDetailId = uuidv4();
  await conn.execute(QUERIES.LEDGER.INSERT_PAYMENT_DETAIL, [
    paymentDetailId, tenantId, expenseAccountId, logId,
    0, 0, gross, 0, gross,
    null, userPhone, userPhone,
  ]);

  const pmtdId = uuidv4();
  await conn.execute(QUERIES.LEDGER.INSERT_PMTD, [
    pmtdId, tenantId, paymentModeId, null,
    description ? String(description).slice(0, 100) : 'Expense',
    userPhone, userPhone,
  ]);

  // NEGATIVE: money leaving the asset account it was paid from.
  await conn.execute(QUERIES.LEDGER.INSERT_BREAKUP, [
    uuidv4(), tenantId, mode.DefaultAccountTypeBaseId, paymentDetailId, pmtdId,
    paymentType.Id, -gross, null, userPhone, userPhone,
  ]);

  // ── Status ───────────────────────────────────────────────────────────────
  await transitionStatus(
    conn,
    { logId, configId, fromStatusId: draft.Id, toStatusId: settled.Id, settledAt: new Date() },
    tenantId, userPhone,
  );

  await conn.execute(QUERIES.LEDGER.UPDATE_EXPENSE_LEDGER_LINK, [
    logId, userPhone, expenseId, tenantId,
  ]);

  return {
    transactionDetailLogId: logId,
    transactionNo,
    status: LEDGER.STATUS_SETTLED,
    amount: gross,
  };
};

module.exports = {
  postSaleFromBill,
  postExpense,
  refundSale,
  transitionStatus,
  applyRoundOff,
  resolveTenderMode,
};
