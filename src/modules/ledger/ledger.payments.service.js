// src/modules/ledger/ledger.payments.service.js
// Money that arrives AFTER the sale: collecting a balance, giving one up, and
// naming who owes it.
//
// ── Why a second payment is a new row, not an edit ─────────────────────────
// A sale saved short (PARTIALLY_PAID) already has one paymentdetail — what was
// taken at the till. The balance collected later is a SECOND paymentdetail with
// its own breakups, stamped when the money actually arrived. Nothing already
// written is changed, which keeps the ledger's one promise (settled documents
// are never edited), and every reader already copes: each report totals
// paymentdetail per document in a GROUP BY, the cash session reads breakups by
// time, and the tender list on the document reads every breakup. So the money
// lands in the till that is open NOW, while the sale keeps its own date.
//
// When the balance reaches ₹0 the sale moves PARTIALLY_PAID → SETTLED through
// the transition already seeded for it (POS_SALE_SETTLE_REMAINDER).
//
// ── Write-off ──────────────────────────────────────────────────────────────
// Not a payment (it would count as money collected) and not a discount (it would
// shrink the sale and hide the loss). It is stamped on the sale as its own
// figure and reported on its own line. See the WriteOffAmount column comment.

const { v4: uuidv4 } = require('uuid');
const { QUERIES, LEDGER } = require('../../config/constants');
const MESSAGES = require('../../config/messages');
const { HttpError } = require('../../middleware/errorHandler');
const { withConnection } = require('../../utils/dbHelper');
const { businessDate } = require('../../utils/dateRange');
const { toMinor, fromMinor } = require('../../utils/taxCalculator');
const { logger } = require('../../utils/logger');
const { requireMaster } = require('./ledger.primitives');
const { resolveTenderMode } = require('./ledger.service');
const { dueOf } = require('./ledger.due');
// Shared with the returns path, which settles a sale whose due a return cleared.
const { settleSaleTx } = require('./ledger.settle');
const { describeSourceRow } = require('./ledger.source');

const isCashMode = (mode) => String(mode?.Type || '').trim().toLowerCase() === 'cash';

/**
 * Locks a sale and reads what it still owes.
 *
 * The lock comes FIRST, before any figure is read: two cashiers collecting the
 * same invoice at once would otherwise both see "₹88 due" and both take it.
 *
 * @returns {Promise<{sale:Object, collected:number, returned:number, due:number}>}
 */
const readBalanceTx = async (conn, saleLogId, tenantId) => {
  const [rows] = await conn.execute(QUERIES.LEDGER.SELECT_SALE_FOR_COLLECT, [saleLogId, tenantId]);
  if (!rows || rows.length === 0) {
    throw new HttpError('Ledger document not found.', MESSAGES.HTTP_STATUS.NOT_FOUND);
  }
  const sale = rows[0];
  if (sale.TypeName !== LEDGER.TYPE_POS_SALE) {
    throw new HttpError(MESSAGES.ERROR.LEDGER_NOT_A_SALE, MESSAGES.HTTP_STATUS.BAD_REQUEST);
  }

  const [[collectedRow]] = await conn.execute(
    QUERIES.LEDGER.SELECT_COLLECTED_TOTAL, [saleLogId, tenantId],
  );
  const [[returnedRow]] = await conn.execute(
    QUERIES.LEDGER.SELECT_RETURNED_TOTAL, [saleLogId, tenantId],
  );
  const collected = Number(collectedRow?.collected || 0);
  const returned = Number(returnedRow?.returned || 0);

  return {
    sale,
    collected,
    returned,
    due: dueOf({
      gross: sale.GrossAmount, collected, returned, writtenOff: sale.WriteOffAmount,
    }),
  };
};

/** Refuses anything that is not a sale with a balance still owed on it. */
const assertCollectable = ({ sale, due }) => {
  if (sale.StatusName !== LEDGER.STATUS_PARTIALLY_PAID || due <= 0) {
    throw new HttpError(
      `${MESSAGES.ERROR.LEDGER_NOTHING_DUE} (${sale.TransactionNo})`,
      MESSAGES.HTTP_STATUS.CONFLICT,
    );
  }
};

/**
 * Takes a payment against a sale's outstanding balance.
 *
 * Runs on the CALLER'S transaction: the payment rows, the status move and the
 * bill update all land or none do.
 *
 * Over-tender follows the till's rule. Only cash can exceed the due, and the
 * excess is change — handed back, never recorded. A card or UPI amount above the
 * due is refused, because there is no change to give on a bank transfer.
 *
 * @param {Object} conn - Open transaction connection.
 * @param {Object} input
 * @param {string} input.saleLogId
 * @param {Array<{paymentModeId:string, amount:number, refNo?:string, comment?:string}>} input.tenders
 * @param {string} tenantId
 * @param {string} userPhone
 * @returns {Promise<Object>} { transactionNo, collected, change, due, status, ... }
 */
const collectPaymentTx = async (conn, input, tenantId, userPhone) => {
  const { saleLogId, tenders = [] } = input;

  const balance = await readBalanceTx(conn, saleLogId, tenantId);
  assertCollectable(balance);
  const { sale } = balance;
  const dueMinor = toMinor(balance.due);

  // Resolve every mode before writing anything, so a missing reference on the
  // second tender cannot leave the first one recorded.
  const resolved = [];
  for (const tender of tenders) {
    if (!(toMinor(tender.amount) > 0)) {
      throw new HttpError(MESSAGES.ERROR.LEDGER_COLLECT_AMOUNT_INVALID, MESSAGES.HTTP_STATUS.BAD_REQUEST);
    }
    const mode = await resolveTenderMode(conn, tender, tenantId);
    resolved.push({ tender, mode, wantedMinor: toMinor(tender.amount) });
  }

  const tenderedMinor = resolved.reduce((s, r) => s + r.wantedMinor, 0);
  const cashMinor = resolved.filter((r) => isCashMode(r.mode)).reduce((s, r) => s + r.wantedMinor, 0);
  const excessMinor = Math.max(0, tenderedMinor - dueMinor);
  if (excessMinor > cashMinor) {
    throw new HttpError(MESSAGES.ERROR.LEDGER_COLLECT_OVERPAID, MESSAGES.HTTP_STATUS.BAD_REQUEST);
  }

  const appliedMinor = Math.min(tenderedMinor, dueMinor);
  const dueAfterMinor = dueMinor - appliedMinor;
  const clears = dueAfterMinor <= 0;

  const salesAccount = await requireMaster(
    conn, QUERIES.LEDGER.SELECT_ACCOUNT_BY_NAME, LEDGER.ACCOUNT_SALES, tenantId, 'account',
  );
  const receivedType = await requireMaster(
    conn, QUERIES.LEDGER.SELECT_RECEIVED_TYPE_BY_NAME,
    clears ? LEDGER.RECEIVED_FULL : LEDGER.RECEIVED_PARTIAL, tenantId, 'received type',
  );

  // One payment, dated now. Tax and discount were recorded on the sale itself;
  // this row is money only.
  const paymentDetailId = uuidv4();
  await conn.execute(QUERIES.LEDGER.INSERT_PAYMENT_DETAIL, [
    paymentDetailId, tenantId, salesAccount.Id, sale.Id,
    0, 0, fromMinor(appliedMinor), 0, fromMinor(appliedMinor),
    null, userPhone, userPhone,
  ]);

  // Non-cash first, so when the total runs past the due it is the CASH row that
  // is trimmed — the excess is the change in the cashier's hand.
  const ordered = [...resolved].sort((a, b) => Number(isCashMode(a.mode)) - Number(isCashMode(b.mode)));
  let remainingMinor = appliedMinor;
  const recorded = [];
  for (const { tender, mode, wantedMinor } of ordered) {
    const applied = Math.min(wantedMinor, remainingMinor);
    remainingMinor -= applied;
    if (applied <= 0) continue;

    const pmtdId = uuidv4();
    await conn.execute(QUERIES.LEDGER.INSERT_PMTD, [
      pmtdId, tenantId, tender.paymentModeId, tender.refNo || null,
      tender.comment || `Balance on ${sale.TransactionNo}`, userPhone, userPhone,
    ]);
    // Booked to the account the money landed in, exactly as at the till — this
    // is what puts a cash collection in the cash session that is open now.
    await conn.execute(QUERIES.LEDGER.INSERT_BREAKUP, [
      uuidv4(), tenantId, mode.DefaultAccountTypeBaseId, paymentDetailId, pmtdId,
      receivedType.Id, fromMinor(applied), null, userPhone, userPhone,
    ]);
    recorded.push({ paymentMode: mode.Type, amount: fromMinor(applied), refNo: tender.refNo || null });
  }

  if (clears) await settleSaleTx(conn, sale, tenantId, userPhone);

  logger.info('Balance collected', {
    saleLogId, transactionNo: sale.TransactionNo, tenantId,
    collected: fromMinor(appliedMinor), dueAfter: fromMinor(Math.max(0, dueAfterMinor)),
  });

  return {
    transactionDetailLogId: sale.Id,
    transactionNo: sale.TransactionNo,
    paymentDetailId,
    collected: fromMinor(appliedMinor),
    change: fromMinor(excessMinor),
    dueBefore: balance.due,
    due: fromMinor(Math.max(0, dueAfterMinor)),
    status: clears ? LEDGER.STATUS_SETTLED : LEDGER.STATUS_PARTIALLY_PAID,
    tenders: recorded,
  };
};

/**
 * Gives up on a sale's remaining balance and closes it.
 *
 * Admin-only at the route. The amount is whatever is due at the moment of the
 * lock — never a figure sent by the client, which could be stale by the time
 * someone else has collected part of it.
 *
 * @param {Object} conn
 * @param {Object} input - { saleLogId, reason, note }
 */
const writeOffTx = async (conn, input, tenantId, userPhone) => {
  const { saleLogId, reason, note = null } = input;

  const reasonRow = LEDGER.WRITE_OFF_REASONS.find(([code]) => code === reason);
  if (!reasonRow) {
    throw new HttpError(MESSAGES.ERROR.LEDGER_WRITE_OFF_REASON, MESSAGES.HTTP_STATUS.BAD_REQUEST);
  }
  const noteText = note ? String(note).trim().slice(0, 500) : '';
  if (reasonRow[2] && !noteText) {
    throw new HttpError(MESSAGES.ERROR.LEDGER_WRITE_OFF_NOTE, MESSAGES.HTTP_STATUS.BAD_REQUEST);
  }

  const balance = await readBalanceTx(conn, saleLogId, tenantId);
  assertCollectable(balance);
  const { sale, due } = balance;

  await conn.execute(QUERIES.LEDGER.SET_WRITE_OFF, [
    due, reason, noteText || null, userPhone, userPhone, sale.Id, tenantId,
  ]);
  await settleSaleTx(conn, sale, tenantId, userPhone);

  logger.info('Balance written off', {
    saleLogId, transactionNo: sale.TransactionNo, tenantId, writtenOff: due, reason,
  });

  return {
    transactionDetailLogId: sale.Id,
    transactionNo: sale.TransactionNo,
    writtenOff: due,
    reason,
    reasonLabel: reasonRow[1],
    due: 0,
    status: LEDGER.STATUS_SETTLED,
  };
};

/**
 * Names who owes a balance on a sale saved short without one.
 *
 * Only the invoice's customer SNAPSHOT changes. A sale linked to a CRM guest
 * already says who they are, and renaming it here would make the invoice
 * disagree with the guest's own record, so that case is refused.
 */
const setDebtorTx = async (conn, input, tenantId, userPhone) => {
  const { saleLogId, name, mobile = null } = input;
  const balance = await readBalanceTx(conn, saleLogId, tenantId);
  const { sale } = balance;
  if (sale.StatusName !== LEDGER.STATUS_PARTIALLY_PAID || balance.due <= 0 || sale.ContactDetailId) {
    throw new HttpError(MESSAGES.ERROR.LEDGER_DEBTOR_LOCKED, MESSAGES.HTTP_STATUS.CONFLICT);
  }
  const cleanName = String(name).trim().slice(0, 150);
  const cleanMobile = mobile ? String(mobile).trim().slice(0, 50) : null;
  await conn.execute(QUERIES.LEDGER.SET_DEBTOR, [
    cleanName, cleanMobile, userPhone, sale.Id, tenantId,
  ]);
  return {
    transactionDetailLogId: sale.Id,
    transactionNo: sale.TransactionNo,
    CustomerName: cleanName,
    CustomerMobile: cleanMobile,
  };
};

// ── Dues worklist ───────────────────────────────────────────────────────────

/** The age buckets the Dues screen filters by. Upper bounds are inclusive. */
const AGE_BUCKETS = {
  today: [0, 0],
  week: [1, 7],
  month: [8, 30],
  older: [31, Number.POSITIVE_INFINITY],
};
const bucketOf = (days) =>
  Object.keys(AGE_BUCKETS).find((k) => days >= AGE_BUCKETS[k][0] && days <= AGE_BUCKETS[k][1]) || 'older';


/**
 * Every sale still owed money, oldest first, with a summary over ALL of them.
 *
 * The summary ignores the age and text filters on purpose: "₹1,486 outstanding"
 * must not change because somebody narrowed the list to today.
 *
 * @param {Object} query - { branchId?, age?: 'today'|'week'|'month'|'older', search? }
 */
const listDues = (query, tenantId) =>
  withConnection(async (conn) => {
    let sql = QUERIES.LEDGER.SELECT_DUES;
    const params = [businessDate(), tenantId, LEDGER.TYPE_POS_SALE];
    if (query.branchId) { sql += ' AND l.BranchId = ?'; params.push(query.branchId); }
    sql += ' ORDER BY l.TransactionDate ASC, l.CreatedOn ASC LIMIT 500';

    const [rows] = await conn.execute(sql, params);

    const all = (rows || []).map((r) => {
      const ageDays = Math.max(0, Number(r.AgeDays) || 0);
      const collected = Number(r.Collected || 0);
      const returned = Number(r.Returned || 0);
      return {
        Id: r.Id,
        TransactionNo: r.TransactionNo,
        TransactionDate: r.TransactionDate,
        CreatedOn: r.CreatedOn,
        LastPaymentAt: r.LastPaymentAt,
        BranchId: r.BranchId,
        BranchName: r.BranchName,
        CustomerName: r.CustomerName,
        CustomerMobile: r.CustomerMobile,
        HasGuest: !!r.ContactDetailId,
        GrossAmount: Number(r.GrossAmount || 0),
        Collected: collected,
        Returned: returned,
        Due: dueOf({ gross: r.GrossAmount, collected, returned, writtenOff: r.WriteOffAmount }),
        AgeDays: ageDays,
        AgeBucket: bucketOf(ageDays),
        Source: describeSourceRow(r),
      };
    }).filter((d) => d.Due > 0);

    const counts = { all: all.length, today: 0, week: 0, month: 0, older: 0 };
    all.forEach((d) => { counts[d.AgeBucket] += 1; });
    const oldest = all.reduce((o, d) => (!o || d.AgeDays > o.AgeDays ? d : o), null);

    const term = String(query.search || '').trim().toLowerCase();
    const documents = all
      .filter((d) => !query.age || d.AgeBucket === query.age)
      .filter((d) => !term || [d.TransactionNo, d.CustomerName, d.CustomerMobile, d.Source.label]
        .some((v) => String(v || '').toLowerCase().includes(term)));

    return {
      summary: {
        outstanding: fromMinor(all.reduce((s, d) => s + toMinor(d.Due), 0)),
        count: all.length,
        oldestDays: oldest ? oldest.AgeDays : 0,
        oldestNo: oldest ? oldest.TransactionNo : null,
        oldestName: oldest ? oldest.CustomerName : null,
        buckets: counts,
      },
      documents,
    };
  });

module.exports = {
  collectPaymentTx,
  writeOffTx,
  setDebtorTx,
  listDues,
  readBalanceTx,
  AGE_BUCKETS,
};
