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
const MESSAGES = require('../../config/messages');
const { LEDGER, POS_BILL_STATUS } = require('../../config/constants');
const { toMinor, fromMinor } = require('../../utils/taxCalculator');
const numberService = require('./transactionNumber.service');
const contactResolver = require('./contactResolver.service');

const toJson = (v) => (v == null ? null : typeof v === 'string' ? v : JSON.stringify(v));

/** Looks a master up by name, failing loudly — a missing master is a seed bug. */
const requireMaster = async (conn, query, name, tenantId, label) => {
  const [rows] = await conn.execute(query, [name, tenantId]);
  if (!rows || rows.length === 0) {
    throw new HttpError(
      `${MESSAGES.ERROR.LEDGER_MASTER_MISSING}${label} '${name}'.`,
      MESSAGES.HTTP_STATUS.BAD_REQUEST,
    );
  }
  return rows[0];
};

/**
 * Rounds a payable to the nearest rupee and reports the adjustment.
 * Cash tills cannot hand over paise, so the ledger records the rounding rather
 * than letting it vanish into a mismatched total.
 * @param {number} gross
 * @returns {{roundedGross:number, roundOff:number}}
 */
const applyRoundOff = (gross) => {
  const grossMinor = toMinor(gross);
  const roundedMinor = Math.round(grossMinor / 100) * 100;
  return {
    roundedGross: fromMinor(roundedMinor),
    roundOff: fromMinor(roundedMinor - grossMinor),
  };
};

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
 * Moves a document to a new status, but only if the whitelist permits it, and
 * records the move.
 *
 * This is the state machine doing its job: `transactiontypebaseconversion` is
 * the rule, `transactiontypeconversionmapper` is the event.
 */
const transitionStatus = async (
  conn, { logId, configId, fromStatusId, toStatusId, settledAt }, tenantId, userEmail,
) => {
  const [permitted] = await conn.execute(QUERIES.LEDGER.SELECT_TRANSITION, [
    configId, fromStatusId, toStatusId, tenantId,
  ]);
  if (!permitted || permitted.length === 0) {
    throw new HttpError(
      MESSAGES.ERROR.LEDGER_TRANSITION_NOT_ALLOWED,
      MESSAGES.HTTP_STATUS.CONFLICT,
    );
  }

  await conn.execute(QUERIES.LEDGER.INSERT_CONVERSION_MAPPER, [
    uuidv4(), tenantId, permitted[0].Id, logId, toStatusId, userEmail, userEmail,
  ]);
  await conn.execute(QUERIES.LEDGER.UPDATE_LOG_STATUS, [
    toStatusId, settledAt ?? null, userEmail, logId, tenantId,
  ]);
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
 * @param {string} userEmail
 * @returns {Promise<Object>} { transactionDetailLogId, transactionNo, status, roundOff, balanceDue }
 */
const postSaleFromBill = async (conn, input, tenantId, userEmail) => {
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
    conn, posCustomerId, tenantId, userEmail,
  );

  // ── Number + header ──────────────────────────────────────────────────────
  const { transactionNo } = await numberService.issueNumber(conn, configId, tenantId, userEmail);
  const logId = uuidv4();

  await conn.execute(QUERIES.LEDGER.INSERT_LOG, [
    logId, tenantId, transactionNo, configId, saleType.Id, draft.Id, branchId ?? null,
    new Date().toISOString().slice(0, 10),
    totals.SubTotal ?? 0, totals.TaxAmount ?? 0, totals.Discount ?? 0,
    roundOff, roundedGross, toJson(totals.TaxByComponent || []),
    customer.contactDetailId, customer.name, customer.mobile,
    null, userEmail, userEmail,
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
      userEmail, userEmail,
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
    null, userEmail, userEmail,
  ]);

  // One paymentbreakup per tender, each with its own instrument row so a card
  // approval code or UPI reference stays attached to the money it belongs to.
  let remainingMinor = settledMinor;
  for (const tender of tenders) {
    const mode = await resolveTenderMode(conn, tender, tenantId);

    const pmtdId = uuidv4();
    await conn.execute(QUERIES.LEDGER.INSERT_PMTD, [
      pmtdId, tenantId, tender.paymentModeId, tender.refNo ?? null,
      tender.comment ?? null, userEmail, userEmail,
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
      receivedType.Id, fromMinor(applied), null, userEmail, userEmail,
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
    tenantId, userEmail,
  );

  await conn.execute(QUERIES.LEDGER.UPDATE_BILL_LEDGER_LINK, [
    logId, userEmail, billId, tenantId,
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
 * Reverses a settled document.
 *
 * Nothing is deleted or overwritten: the original stands, the status moves
 * SETTLED → REFUNDED (recorded), and a negative tender is written so the money
 * out is as traceable as the money in.
 */
const refundSale = async (conn, logId, reason, tenantId, userEmail) => {
  const [logs] = await conn.execute(QUERIES.LEDGER.SELECT_LOG_FULL, [logId, tenantId]);
  if (!logs || logs.length === 0) {
    throw new HttpError('Ledger document not found.', MESSAGES.HTTP_STATUS.NOT_FOUND);
  }
  const log = logs[0];

  const settled = await requireMaster(
    conn, QUERIES.LEDGER.SELECT_STATUS_BY_NAME, LEDGER.STATUS_SETTLED, tenantId, 'status',
  );
  const refunded = await requireMaster(
    conn, QUERIES.LEDGER.SELECT_STATUS_BY_NAME, LEDGER.STATUS_REFUNDED, tenantId, 'status',
  );
  const refundType = await requireMaster(
    conn, QUERIES.LEDGER.SELECT_RECEIVED_TYPE_BY_NAME, LEDGER.RECEIVED_REFUND, tenantId, 'received type',
  );
  const salesAccount = await requireMaster(
    conn, QUERIES.LEDGER.SELECT_ACCOUNT_BY_NAME, LEDGER.ACCOUNT_SALES, tenantId, 'account',
  );

  // Only a settled sale can be refunded. The whitelist has no
  // SETTLED → CANCELLED, so this is the only way back out.
  await transitionStatus(
    conn,
    {
      logId, configId: log.TransactionTypeConfigId,
      fromStatusId: settled.Id, toStatusId: refunded.Id, settledAt: log.SettledAt,
    },
    tenantId, userEmail,
  );

  // Mirror each original tender as a negative one, back to the mode it came in
  // on. `paymentmodetransactiondetail.PaymentModeId` is NOT NULL, and refunding
  // cash to a card would be wrong anyway — the money goes back the way it came.
  const [payments] = await conn.execute(QUERIES.LEDGER.SELECT_PAYMENT_DETAIL_BY_LOG, [logId, tenantId]);
  if (payments && payments.length > 0) {
    const [originals] = await conn.execute(
      `SELECT b.Amount, b.AccountTypeBaseId, pmtd.PaymentModeId
         FROM paymentbreakup b
         JOIN paymentmodetransactiondetail pmtd ON pmtd.Id = b.PaymentModeTransactionDetailId
        WHERE b.PaymentDetailId = ? AND b.TenantId = ? AND b.Amount > 0`,
      [payments[0].Id, tenantId],
    );

    for (const original of originals || []) {
      const pmtdId = uuidv4();
      await conn.execute(QUERIES.LEDGER.INSERT_PMTD, [
        pmtdId, tenantId, original.PaymentModeId, null,
        reason ? String(reason).slice(0, 100) : 'Refund',
        userEmail, userEmail,
      ]);
      // Reversed out of the SAME account the money went into, so the asset
      // account nets to zero rather than leaving cash that was never there.
      await conn.execute(QUERIES.LEDGER.INSERT_BREAKUP, [
        uuidv4(), tenantId, original.AccountTypeBaseId || salesAccount.Id,
        payments[0].Id, pmtdId,
        refundType.Id, -Number(original.Amount || 0), null, userEmail, userEmail,
      ]);
    }
  }

  // The POS side must not go on claiming 'paid' for a document the ledger has
  // reversed. Same transaction, so the two can never disagree.
  await conn.execute(QUERIES.LEDGER.UPDATE_BILL_STATUS_BY_LOG, [
    POS_BILL_STATUS.REFUNDED, userEmail, logId, tenantId,
  ]);

  return { transactionDetailLogId: logId, status: LEDGER.STATUS_REFUNDED };
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
 * @param {string} userEmail
 * @returns {Promise<Object>} { transactionDetailLogId, transactionNo, status }
 */
const postExpense = async (conn, input, tenantId, userEmail) => {
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
  const { transactionNo } = await numberService.issueNumber(conn, configId, tenantId, userEmail);
  const logId = uuidv4();
  const gross = Number(amount) || 0;

  // An expense carries no tax breakdown and no customer — it is a payment, not
  // a sale. Amount sits in Net and Gross so the two agree.
  await conn.execute(QUERIES.LEDGER.INSERT_LOG, [
    logId, tenantId, transactionNo, configId, expenseType.Id, draft.Id, branchId ?? null,
    (expenseDate ? new Date(expenseDate) : new Date()).toISOString().slice(0, 10),
    gross, 0, 0, 0, gross, toJson([]),
    null, null, null,
    description ? String(description).slice(0, 500) : null, userEmail, userEmail,
  ]);

  // ── Payment ──────────────────────────────────────────────────────────────
  const paymentDetailId = uuidv4();
  await conn.execute(QUERIES.LEDGER.INSERT_PAYMENT_DETAIL, [
    paymentDetailId, tenantId, expenseAccountId, logId,
    0, 0, gross, 0, gross,
    null, userEmail, userEmail,
  ]);

  const pmtdId = uuidv4();
  await conn.execute(QUERIES.LEDGER.INSERT_PMTD, [
    pmtdId, tenantId, paymentModeId, null,
    description ? String(description).slice(0, 100) : 'Expense',
    userEmail, userEmail,
  ]);

  // NEGATIVE: money leaving the asset account it was paid from.
  await conn.execute(QUERIES.LEDGER.INSERT_BREAKUP, [
    uuidv4(), tenantId, mode.DefaultAccountTypeBaseId, paymentDetailId, pmtdId,
    paymentType.Id, -gross, null, userEmail, userEmail,
  ]);

  // ── Status ───────────────────────────────────────────────────────────────
  await transitionStatus(
    conn,
    { logId, configId, fromStatusId: draft.Id, toStatusId: settled.Id, settledAt: new Date() },
    tenantId, userEmail,
  );

  await conn.execute(QUERIES.LEDGER.UPDATE_EXPENSE_LEDGER_LINK, [
    logId, userEmail, expenseId, tenantId,
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
