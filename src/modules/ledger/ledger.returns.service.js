// src/modules/ledger/ledger.returns.service.js
// A return is a DOCUMENT, not a status change.
//
// ── Why this file exists rather than a bigger refundSale() ──────────────────
// The old model moved the sale's own status SETTLED → REFUNDED. That is
// terminal and all-or-nothing, and it failed in four separate places the moment
// a SECOND, smaller return was attempted:
//
//   · the transition whitelist has no self-transition, so the second refund was
//     rejected outright at the state machine;
//   · UNIQUE (TenantId, SourceType, SourceId, EntryType) on the loyalty ledger
//     made the second REVERSAL against the same bill violate a constraint and
//     roll the whole transaction back;
//   · nothing recorded WHICH items came back, at any granularity;
//   · eleven report queries filter on SETTLED/PARTIALLY_PAID, so a refunded
//     sale silently vanished from revenue — last Tuesday's gross changed when
//     somebody refunded on Friday.
//
// Modelling each return as its own numbered credit note dissolves the first
// three rather than fixing them. The sale is NEVER mutated; how refunded it is
// becomes a derived figure — SUM(notes) against GrossAmount — so returns simply
// accumulate and the invoice still reads exactly as it did the day it settled.
//
// This is also what the codebase already argued for. ledger.service.js says it
// outright: "Nothing is deleted or overwritten: the original stands." A second
// document honours that. A mutated status does not.
//
// ── SOLID note ─────────────────────────────────────────────────────────────
// Deliberately a sibling of ledger.service.js rather than more of it. That file
// posts sales and expenses; this one reverses them. They share the primitives
// (numbering, transitions, master lookup) through explicit imports rather than
// by living in one 900-line module with two reasons to change.

const { v4: uuidv4 } = require('uuid');
const { QUERIES, LEDGER, POS_BILL_STATUS } = require('../../config/constants');
const MESSAGES = require('../../config/messages');
const { HttpError } = require('../../middleware/errorHandler');
const { logger } = require('../../utils/logger');
const { businessDate } = require('../../utils/dateRange');
const { toMinor, fromMinor } = require('../../utils/taxCalculator');
const numberService = require('./transactionNumber.service');
const {
  requireMaster, transitionStatus, applyRoundOff,
} = require('./ledger.primitives');
const customerStats = require('../poscustomer/poscustomer.stats.service');
const loyalty = require('../loyalty/loyalty.service');
const outbox = require('../notification/notification.outbox');

const toJson = (v) => (v == null ? null : typeof v === 'string' ? v : JSON.stringify(v));

const asArray = (v) => {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') {
    try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch { return []; }
  }
  return [];
};

/**
 * How refunded a sale is, derived rather than stored.
 *
 * Exported because three different callers need the same answer and a second
 * implementation would eventually disagree with this one: the ledger list
 * column, the document detail drawer, and the guard inside a return.
 *
 * @param {number} gross - The sale's GrossAmount.
 * @param {number} returned - SUM of credit notes against it.
 * @returns {'NONE'|'PARTIALLY_REFUNDED'|'REFUNDED'}
 */
const refundState = (gross, returned) => {
  const g = toMinor(gross || 0);
  const r = toMinor(returned || 0);
  if (r <= 0) return LEDGER.REFUND_STATE.NONE;
  // Within a paisa of the whole thing counts as fully refunded: a sequence of
  // proportional partial returns will not land on the exact total, and calling
  // a fully-returned sale "partially refunded" over a rounding remainder would
  // be wrong on the screen and wrong in the report.
  if (r >= g - 1) return LEDGER.REFUND_STATE.FULL;
  return LEDGER.REFUND_STATE.PARTIAL;
};

/**
 * Split a refund across the tenders the sale was actually paid with.
 *
 * ── The rule, chosen deliberately ──────────────────────────────────────────
 * CASH FIRST, then the rest in the order they were tendered. A ₹1,240 bill paid
 * ₹240 cash + ₹1,000 card, refunded ₹500, sends ₹240 cash and ₹260 card —
 * which is what a till actually does, and what keeps a drawer count honest.
 * Pro-rata (₹97/₹403) is defensible but does not match the physical act.
 *
 * ── The invariant that matters more than the rule ──────────────────────────
 * NO MODE IS EVER REFUNDED MORE THAN IT RECEIVED. Without it a sequence of
 * partial returns can hand back cash the customer never paid in cash. The
 * remaining capacity per tender is computed from what came in MINUS what has
 * already gone back, so it holds across any number of returns.
 *
 * @param {Array} tenders - [{ paymentModeId, accountTypeBaseId, remainingMinor }]
 * @param {number} amountMinor - What to give back, in minor units.
 * @returns {Array<{paymentModeId, accountTypeBaseId, amountMinor}>}
 */
const apportionRefund = (tenders, amountMinor) => {
  const ordered = [...tenders].sort((a, b) => {
    // Cash first; everything else keeps the order it was tendered in.
    if (a.isCash && !b.isCash) return -1;
    if (!a.isCash && b.isCash) return 1;
    return 0;
  });

  const out = [];
  let left = amountMinor;
  for (const t of ordered) {
    if (left <= 0) break;
    const take = Math.min(left, Math.max(0, t.remainingMinor));
    if (take <= 0) continue;
    out.push({
      paymentModeId: t.paymentModeId,
      accountTypeBaseId: t.accountTypeBaseId,
      amountMinor: take,
    });
    left -= take;
  }

  if (left > 0) {
    // Every tender is exhausted and there is still money to give back. That
    // means the sale was refunded beyond what was collected on it — refuse
    // rather than invent a mode to pay it from.
    throw new HttpError(
      MESSAGES.ERROR.LEDGER_REFUND_EXCEEDS_TENDERS,
      MESSAGES.HTTP_STATUS.CONFLICT,
    );
  }
  return out;
};

/**
 * What each tender still has capacity to refund.
 *
 * Reads the original positive breakups and nets off every negative one already
 * written against the same payment detail — so this is correct on the fifth
 * return, not just the first.
 */
const tenderCapacity = async (conn, paymentDetailId, tenantId) => {
  const [rows] = await conn.execute(
    `SELECT pmtd.PaymentModeId,
            b.AccountTypeBaseId,
            pm.Type AS ModeType,
            SUM(b.Amount) AS NetAmount,
            MIN(b.CreatedOn) AS FirstSeen
       FROM paymentbreakup b
       JOIN paymentmodetransactiondetail pmtd
         ON pmtd.Id = b.PaymentModeTransactionDetailId
       LEFT JOIN paymentmode pm ON pm.Id = pmtd.PaymentModeId
      WHERE b.PaymentDetailId = ? AND b.TenantId = ?
      GROUP BY pmtd.PaymentModeId, b.AccountTypeBaseId, pm.Type
      HAVING SUM(b.Amount) > 0
      ORDER BY FirstSeen ASC`,
    [paymentDetailId, tenantId],
  );

  return (rows || []).map((r) => ({
    paymentModeId: r.PaymentModeId,
    accountTypeBaseId: r.AccountTypeBaseId,
    isCash: String(r.ModeType || '').toLowerCase() === 'cash',
    remainingMinor: toMinor(r.NetAmount || 0),
  }));
};

/**
 * Price the returned lines from the ORIGINAL lines.
 *
 * Never recomputed at today's rates: an invoice raised at 12% GST must give
 * back 12%, whatever the rate is when the customer walks in. Mirrors the rule
 * loyalty already applies — reverse what was granted, not what would be granted
 * now.
 *
 * A partial quantity takes a proportional share of everything the original line
 * carried, including its share of a whole-bill discount, so returning one of
 * three naans gives back exactly a third of what that line contributed.
 */
const priceReturnLines = (requested, originalById, alreadyReturnedByLine) => {
  const priced = [];
  let netMinor = 0;
  let taxMinor = 0;
  let grossMinor = 0;
  let discountMinor = 0;

  for (const req of requested) {
    const original = originalById.get(req.lineId);
    if (!original) {
      throw new HttpError(
        `${MESSAGES.ERROR.LEDGER_RETURN_LINE_UNKNOWN}${req.lineId}`,
        MESSAGES.HTTP_STATUS.BAD_REQUEST,
      );
    }

    const soldQty = Number(original.Quantity) || 0;
    const doneQty = Number(alreadyReturnedByLine.get(req.lineId) || 0);
    const wantQty = Number(req.quantity) || 0;

    if (wantQty <= 0) {
      throw new HttpError(
        MESSAGES.ERROR.LEDGER_RETURN_QTY_INVALID,
        MESSAGES.HTTP_STATUS.BAD_REQUEST,
      );
    }
    // The guard that stops a second return taking a quantity never sold.
    if (doneQty + wantQty > soldQty + 1e-9) {
      throw new HttpError(
        `${MESSAGES.ERROR.LEDGER_RETURN_QTY_EXCEEDS}"${original.ItemName || original.Comment || 'item'}"`
        + ` — sold ${soldQty}, already returned ${doneQty}, asked for ${wantQty}.`,
        MESSAGES.HTTP_STATUS.CONFLICT,
      );
    }

    // Proportional share of everything the original line carried.
    const share = soldQty > 0 ? wantQty / soldQty : 0;
    const lineNet = Math.round(toMinor(original.NetAmount || 0) * share);
    const lineTax = Math.round(toMinor(original.TaxAmount || 0) * share);
    const lineGross = Math.round(toMinor(original.GrossAmount || 0) * share);
    const lineDisc = Math.round(toMinor(original.DiscountAmount || 0) * share);
    const lineItemDisc = Math.round(toMinor(original.ItemDiscountAmount || 0) * share);

    netMinor += lineNet;
    taxMinor += lineTax;
    grossMinor += lineGross;
    discountMinor += lineDisc;

    priced.push({
      sourceLineId: req.lineId,
      itemId: original.ItemId,
      quantity: wantQty,
      costInfoId: original.CostInfoId,
      unitPrice: original.UnitPrice,
      basePrice: original.BasePrice,
      variantAmount: original.VariantAmount,
      netAmount: fromMinor(lineNet),
      discountAmount: fromMinor(lineDisc),
      itemDiscountAmount: fromMinor(lineItemDisc),
      taxAmount: fromMinor(lineTax),
      grossAmount: fromMinor(lineGross),
      // Per-component tax scaled the same way, so a credit note's footer splits
      // CGST/SGST exactly as the invoice did.
      taxComponents: asArray(original.TaxComponents).map((c) => ({
        ...c,
        amount: fromMinor(Math.round(toMinor(c.amount || 0) * share)),
      })),
      variants: asArray(original.Variants),
      name: original.ItemName || original.Comment || null,
      // Intent only — there is no stock ledger to restock into. See the
      // RestockRequested column comment.
      restockRequested: !!req.restock,
    });
  }

  return {
    lines: priced,
    totals: {
      net: fromMinor(netMinor),
      tax: fromMinor(taxMinor),
      gross: fromMinor(grossMinor),
      discount: fromMinor(discountMinor),
    },
    grossMinor,
  };
};

/**
 * Create a credit note against a settled sale.
 *
 * Runs on the CALLER'S transaction — the whole point is that the note, its
 * lines, the money out, the CRM reversal and the loyalty claw-back either all
 * happen or none do.
 *
 * @param {Object} conn - Open transaction connection.
 * @param {Object} input
 * @param {string} input.saleLogId       - The document being returned against.
 * @param {Array}  input.lines           - [{ lineId, quantity, restock? }]. Empty = whole sale.
 * @param {string} [input.reasonId]      - pos_return_reason id.
 * @param {string} [input.note]          - Free text ALONGSIDE the coded reason.
 * @param {string} [input.destination]   - ORIGINAL | STORE_CREDIT.
 * @param {string} [input.idempotencyKey]- Makes a double-clicked button safe.
 * @param {string} tenantId
 * @param {string} userEmail
 */
const createReturnTx = async (conn, input, tenantId, userEmail) => {
  const {
    saleLogId, lines: requestedLines = [], reasonId = null, note = null,
    destination = LEDGER.REFUND_DESTINATION.ORIGINAL,
    idempotencyKey = null,
  } = input;

  // ── 1. Lock the sale ─────────────────────────────────────────────────────
  // BEFORE anything is read about how much has come back. Two cashiers
  // refunding one invoice simultaneously would otherwise both read "nothing
  // returned yet" and both be allowed the whole amount. Same row-lock
  // discipline the numbering counter uses to stop two tills taking one number.
  const [saleRows] = await conn.execute(
    QUERIES.LEDGER.SELECT_SALE_FOR_RETURN, [saleLogId, tenantId],
  );
  if (!saleRows || saleRows.length === 0) {
    throw new HttpError('Ledger document not found.', MESSAGES.HTTP_STATUS.NOT_FOUND);
  }
  const sale = saleRows[0];

  if (sale.StatusName !== LEDGER.STATUS_SETTLED
      && sale.StatusName !== LEDGER.STATUS_PARTIALLY_PAID) {
    throw new HttpError(
      MESSAGES.ERROR.LEDGER_RETURN_NOT_SETTLED,
      MESSAGES.HTTP_STATUS.CONFLICT,
    );
  }

  // ── 2. Idempotency ───────────────────────────────────────────────────────
  // The old model's accidental guard was the status transition failing the
  // second time. Removing that terminal state removes the guard with it, so a
  // double-clicked Refund button would issue two credit notes. This replaces it
  // explicitly, in the same shape as postSaleFromBill's SELECT_BILL_LEDGER_LINK.
  if (idempotencyKey) {
    const [dupes] = await conn.execute(
      `SELECT Id, TransactionNo, GrossAmount FROM transactiondetaillog
        WHERE TenantId = ? AND ReversesLogId = ? AND Remarks = ? LIMIT 1`,
      [tenantId, saleLogId, `idem:${idempotencyKey}`],
    );
    if (dupes && dupes.length > 0) {
      logger.info('Return request replayed — returning the existing credit note', {
        saleLogId, idempotencyKey, tenantId,
      });
      return {
        transactionDetailLogId: dupes[0].Id,
        transactionNo: dupes[0].TransactionNo,
        grossAmount: Number(dupes[0].GrossAmount),
        duplicate: true,
      };
    }
  }

  // ── 3. What has already come back ────────────────────────────────────────
  const [[totalRow]] = await conn.execute(
    QUERIES.LEDGER.SELECT_RETURNED_TOTAL, [saleLogId, tenantId],
  );
  const alreadyReturned = Number(totalRow?.returned || 0);

  const [byLineRows] = await conn.execute(
    QUERIES.LEDGER.SELECT_RETURNED_BY_LINE, [saleLogId, tenantId],
  );
  const alreadyReturnedByLine = new Map(
    (byLineRows || []).map((r) => [r.SourceLineId, Number(r.returnedQty || 0)]),
  );

  // ── 4. Original lines ────────────────────────────────────────────────────
  const [originalLines] = await conn.execute(
    QUERIES.LEDGER.SELECT_LINES_BY_LOG, [saleLogId, tenantId],
  );
  if (!originalLines || originalLines.length === 0) {
    throw new HttpError(
      MESSAGES.ERROR.LEDGER_RETURN_NO_LINES,
      MESSAGES.HTTP_STATUS.BAD_REQUEST,
    );
  }
  const originalById = new Map(originalLines.map((l) => [l.Id, l]));

  // An empty selection means "all of it, whatever is left" — which is what
  // makes the legacy full-refund endpoint expressible as a special case of
  // this one rather than a separate code path.
  const requested = requestedLines.length > 0
    ? requestedLines
    : originalLines
      .map((l) => ({
        lineId: l.Id,
        quantity: Number(l.Quantity || 0) - Number(alreadyReturnedByLine.get(l.Id) || 0),
        restock: false,
      }))
      .filter((l) => l.quantity > 0);

  if (requested.length === 0) {
    throw new HttpError(
      MESSAGES.ERROR.LEDGER_ALREADY_FULLY_RETURNED,
      MESSAGES.HTTP_STATUS.CONFLICT,
    );
  }

  const priced = priceReturnLines(requested, originalById, alreadyReturnedByLine);

  // ── 5. The invariant: returns never exceed the sale ───────────────────────
  const saleGrossMinor = toMinor(sale.GrossAmount || 0);
  const wouldTotalMinor = toMinor(alreadyReturned) + priced.grossMinor;
  if (wouldTotalMinor > saleGrossMinor + 1) {
    throw new HttpError(
      `${MESSAGES.ERROR.LEDGER_RETURN_EXCEEDS_SALE} Invoice ${sale.TransactionNo}: `
      + `${fromMinor(saleGrossMinor)} total, ${alreadyReturned} already returned, `
      + `${priced.totals.gross} requested.`,
      MESSAGES.HTTP_STATUS.CONFLICT,
    );
  }

  // ── 6. Masters + number ──────────────────────────────────────────────────
  const returnType = await requireMaster(
    conn, QUERIES.LEDGER.SELECT_TYPE_BY_NAME, LEDGER.TYPE_POS_RETURN, tenantId, 'transaction type',
  );
  const draft = await requireMaster(
    conn, QUERIES.LEDGER.SELECT_STATUS_BY_NAME, LEDGER.STATUS_DRAFT, tenantId, 'status',
  );
  const settled = await requireMaster(
    conn, QUERIES.LEDGER.SELECT_STATUS_BY_NAME, LEDGER.STATUS_SETTLED, tenantId, 'status',
  );
  const refundType = await requireMaster(
    conn, QUERIES.LEDGER.SELECT_RECEIVED_TYPE_BY_NAME, LEDGER.RECEIVED_REFUND, tenantId, 'received type',
  );
  const salesAccount = await requireMaster(
    conn, QUERIES.LEDGER.SELECT_ACCOUNT_BY_NAME, LEDGER.ACCOUNT_SALES, tenantId, 'account',
  );
  const configId = returnType.TransactionTypeConfigId;

  const { transactionNo } = await numberService.issueNumber(conn, configId, tenantId, userEmail);
  const noteId = uuidv4();

  // A credit note carries POSITIVE amounts in its own columns — a note for ₹500
  // says ₹500. The SIGN is carried by the document type, exactly as an expense
  // already does, and by the negative paymentbreakup rows below.
  await conn.execute(QUERIES.LEDGER.INSERT_RETURN_LOG, [
    noteId, tenantId, transactionNo, configId, returnType.Id, draft.Id,
    sale.BranchId ?? null, businessDate(),
    priced.totals.net, priced.totals.tax, priced.totals.discount,
    0, priced.totals.gross,
    toJson(priced.lines.flatMap((l) => l.taxComponents)),
    sale.ContactDetailId ?? null, sale.CustomerName ?? null, sale.CustomerMobile ?? null,
    saleLogId,
    // Store credit is issued instantly; money back through a tender is settled
    // the moment the cashier hands it over, which today is also instant. The
    // field exists so a gateway can make it genuinely asynchronous later.
    LEDGER.SETTLEMENT_STATUS.SETTLED,
    // The PSP reference, which does not exist until a gateway does. The reason
    // has its own column beside it — one field with two meanings ends up
    // holding whichever the last writer meant.
    null,
    reasonId,
    idempotencyKey ? `idem:${idempotencyKey}` : (note ? String(note).slice(0, 500) : null),
    userEmail, userEmail,
  ]);

  // ── 7. Lines — these ARE the returned goods ──────────────────────────────
  let lineNo = 0;
  for (const l of priced.lines) {
    lineNo += 1;
    await conn.execute(QUERIES.LEDGER.INSERT_RETURN_LINE, [
      uuidv4(), tenantId, noteId, lineNo, l.itemId, l.quantity, l.costInfoId,
      l.unitPrice, l.basePrice, l.variantAmount,
      l.netAmount, l.discountAmount, l.itemDiscountAmount,
      l.taxAmount, l.grossAmount,
      toJson(l.taxComponents), toJson(l.variants),
      l.name ? String(l.name).slice(0, 100) : null,
      l.sourceLineId, l.restockRequested ? 1 : 0,
      userEmail, userEmail,
    ]);
  }

  // ── 8. Money out ─────────────────────────────────────────────────────────
  const paymentDetailId = uuidv4();
  await conn.execute(QUERIES.LEDGER.INSERT_PAYMENT_DETAIL, [
    paymentDetailId, tenantId, salesAccount.Id, noteId,
    priced.totals.discount, 0, priced.totals.gross,
    priced.totals.tax, priced.totals.net,
    null, userEmail, userEmail,
  ]);

  if (destination === LEDGER.REFUND_DESTINATION.STORE_CREDIT) {
    // Nothing leaves the drawer. Booking this as a cash refund would make the
    // till short by an amount that never moved, so it books to a LIABILITY.
    const creditAccount = await requireMaster(
      conn, QUERIES.LEDGER.SELECT_ACCOUNT_BY_NAME,
      LEDGER.ACCOUNT_STORE_CREDIT, tenantId, 'account',
    );
    const pmtdId = uuidv4();
    await conn.execute(QUERIES.LEDGER.INSERT_PMTD, [
      pmtdId, tenantId, null, null, 'Store credit issued', userEmail, userEmail,
    ]);
    await conn.execute(QUERIES.LEDGER.INSERT_BREAKUP, [
      uuidv4(), tenantId, creditAccount.Id, paymentDetailId, pmtdId,
      refundType.Id, -priced.totals.gross, null, userEmail, userEmail,
    ]);
  } else {
    // Back to the modes it arrived on, cash first, never more than each
    // received. Negative amounts, so the daily drawer reconciliation and the
    // tender mix pick this up with NO new code — that convention, chosen long
    // before returns existed, is why cash sessions need no change at all.
    const [payments] = await conn.execute(
      QUERIES.LEDGER.SELECT_PAYMENT_DETAIL_BY_LOG, [saleLogId, tenantId],
    );
    if (!payments || payments.length === 0) {
      throw new HttpError(
        MESSAGES.ERROR.LEDGER_RETURN_NO_PAYMENT,
        MESSAGES.HTTP_STATUS.CONFLICT,
      );
    }
    const capacity = await tenderCapacity(conn, payments[0].Id, tenantId);
    const splits = apportionRefund(capacity, priced.grossMinor);

    for (const split of splits) {
      const pmtdId = uuidv4();
      await conn.execute(QUERIES.LEDGER.INSERT_PMTD, [
        pmtdId, tenantId, split.paymentModeId, null,
        `Return ${transactionNo}`, userEmail, userEmail,
      ]);
      // Reversed out of the SAME account the money went into, so the asset
      // account nets to zero rather than leaving cash that was never there.
      await conn.execute(QUERIES.LEDGER.INSERT_BREAKUP, [
        uuidv4(), tenantId, split.accountTypeBaseId || salesAccount.Id,
        // Against the ORIGINAL payment detail: that is what makes the tender's
        // remaining capacity computable on the next return.
        payments[0].Id, pmtdId,
        refundType.Id, -fromMinor(split.amountMinor), null, userEmail, userEmail,
      ]);
    }
  }

  // ── 9. The note's own status ─────────────────────────────────────────────
  await transitionStatus(
    conn,
    { logId: noteId, configId, fromStatusId: draft.Id, toStatusId: settled.Id, settledAt: new Date() },
    tenantId, userEmail,
  );

  const totalReturnedMinor = wouldTotalMinor;
  const state = refundState(sale.GrossAmount, fromMinor(totalReturnedMinor));

  logger.info('Credit note raised', {
    saleLogId, noteId, transactionNo, tenantId,
    gross: priced.totals.gross, state,
  });

  return {
    transactionDetailLogId: noteId,
    transactionNo,
    grossAmount: priced.totals.gross,
    netAmount: priced.totals.net,
    taxAmount: priced.totals.tax,
    lines: priced.lines.length,
    refundState: state,
    totalReturned: fromMinor(totalReturnedMinor),
    saleGross: Number(sale.GrossAmount),
    duplicate: false,
    // Carried out for the caller to finish the downstream work — see
    // applyDownstreamTx. Kept separate so the money half is testable alone.
    _context: { sale, state, returnedNow: priced.totals.gross },
  };
};

/**
 * The non-financial consequences: CRM, loyalty, the POS bill, and the outbox.
 *
 * Split from createReturnTx because they answer a different question and fail
 * for different reasons — but still on the SAME transaction, so a refund that
 * rolls back keeps the points it was about to take.
 */
const applyDownstreamTx = async (conn, result, tenantId, userEmail) => {
  const { sale, state, returnedNow } = result._context;

  const [bills] = await conn.execute(
    QUERIES.LEDGER.SELECT_BILL_CUSTOMER_BY_LOG, [sale.Id, tenantId],
  );
  const bill = bills[0];

  // The POS side must not go on claiming 'paid' for a document the ledger has
  // partly reversed. Same transaction, so the two can never disagree.
  await conn.execute(QUERIES.LEDGER.UPDATE_BILL_STATUS_BY_LOG, [
    state === LEDGER.REFUND_STATE.FULL
      ? POS_BILL_STATUS.REFUNDED
      : POS_BILL_STATUS.PARTIALLY_REFUNDED,
    userEmail, sale.Id, tenantId,
  ]);

  let pointsReversed = 0;
  if (bill?.CustomerId) {
    // Returning one item from a four-item dinner did not un-happen the visit.
    // The visit only comes off on a FULL return; spend comes off either way,
    // by the value actually returned.
    await customerStats.reverseSaleTx(
      conn, bill.CustomerId, returnedNow, tenantId, userEmail,
      { removeVisit: state === LEDGER.REFUND_STATE.FULL },
    );

    // Proportional claw-back, keyed on the CREDIT NOTE rather than the bill.
    // That is what makes the second partial return legal: the loyalty ledger's
    // UNIQUE (TenantId, SourceType, SourceId, EntryType) would reject a second
    // REVERSAL against the same bill, but each note is its own source.
    pointsReversed = await loyalty.reverseForReturnTx(conn, {
      billId: bill.BillId,
      returnLogId: result.transactionDetailLogId,
      returnedAmount: returnedNow,
      originalAmount: Number(sale.GrossAmount) || 0,
      isFinal: state === LEDGER.REFUND_STATE.FULL,
      reason: `Return ${result.transactionNo}`,
      branchDetailId: bill.BranchDetailId,
    }, tenantId, userEmail);
  }

  // An INTENT to notify, made as durable as the refund itself. Delivery happens
  // elsewhere — a mail-provider timeout must never roll back a completed
  // refund. There is no worker yet; see the notification_outbox table comment.
  await outbox.enqueueTx(conn, {
    eventType: 'RETURN_RECORDED',
    audience: 'customer',
    sourceType: 'RETURN',
    sourceId: result.transactionDetailLogId,
    payload: {
      creditNoteNo: result.transactionNo,
      invoiceNo: sale.TransactionNo,
      amount: returnedNow,
      customerName: sale.CustomerName,
      customerMobile: sale.CustomerMobile,
      refundState: state,
    },
  }, tenantId, userEmail);

  return { pointsReversed, billStatus: state };
};

module.exports = {
  createReturnTx,
  applyDownstreamTx,
  refundState,
  apportionRefund,
  priceReturnLines,
  tenderCapacity,
};
