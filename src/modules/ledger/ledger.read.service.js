// src/modules/ledger/ledger.read.service.js
// Read side of the ledger — the accountant's view.
//
// Strictly read-only by design. A settled document is corrected by refund, never
// by editing, so there is deliberately no update path here.

const { withConnection } = require('../../utils/dbHelper');
const { QUERIES, LEDGER } = require('../../config/constants');
const { HttpError } = require('../../middleware/errorHandler');
const MESSAGES = require('../../config/messages');
// One implementation of "how refunded is this sale" — a second would eventually
// disagree with the first.
const { refundState } = require('./ledger.returns.service');
const {
  calculatePagination,
  getPaginationMetadata,
} = require('../../utils/paginationHelper');

const parseJson = (v) => {
  if (Array.isArray(v) || (v && typeof v === 'object')) return v;
  if (typeof v === 'string') {
    try { return JSON.parse(v); } catch { return null; }
  }
  return null;
};

/**
 * How a document is identified to a human: by token, by table, or by neither.
 *
 * Derived on the server so the ledger list, the ledger detail, the dashboard and
 * any future screen cannot each invent their own rule for what an order "is".
 *
 * @param {Array} orders - Rounds the document covers.
 * @returns {{kind:'token'|'table'|'none', label:string|null, orderNos:string[]}}
 */
const sourceOf = (tokenLabel, tableName, orderNos = []) => {
  // Token wins: a counter customer is holding a number, not a table. A round
  // can legitimately have both if it was moved, and the number is what was
  // actually handed over.
  if (tokenLabel) return { kind: 'token', label: tokenLabel, orderNos };
  if (tableName) return { kind: 'table', label: tableName, orderNos };
  return { kind: 'none', label: null, orderNos };
};

/** From the joined rounds of one document (the detail read). */
const describeSource = (orders = []) => {
  const join = (key) => [...new Set(orders.map((o) => o[key]).filter(Boolean))].join(', ') || null;
  return sourceOf(join('TokenLabel'), join('TableName'), orders.map((o) => o.OrderNo).filter(Boolean));
};

/** From the pre-concatenated columns the LIST query returns. Same rule. */
const splitList = (v) => (v ? String(v).split(', ').filter(Boolean) : []);
const describeSourceRow = (row) =>
  sourceOf(row.TokenLabels || null, row.TableNames || null, splitList(row.OrderNos));

/**
 * Lists ledger documents, newest first.
 * @param {Object} filters - { status, fromDate, toDate, contactDetailId, search }
 */
const listDocuments = (filters, page, limit, tenantId) =>
  withConnection(async (conn) => {
    const { pageNum, limitNum, offset } = calculatePagination(page, limit);

    const where = [];
    const params = [tenantId];
    if (filters.status) { where.push('s.Name = ?'); params.push(filters.status); }
    if (filters.fromDate) { where.push('l.TransactionDate >= ?'); params.push(filters.fromDate); }
    if (filters.toDate) { where.push('l.TransactionDate <= ?'); params.push(filters.toDate); }
    if (filters.contactDetailId) { where.push('l.ContactDetailId = ?'); params.push(filters.contactDetailId); }
    if (filters.branchId) { where.push('l.BranchId = ?'); params.push(filters.branchId); }
    // WHICH KIND of document. The ledger holds sales, expenses and credit
    // notes; without this a CN-0007 sits in the list looking exactly like a
    // sale of the same value.
    if (filters.docType) { where.push('t.Name = ?'); params.push(filters.docType); }
    // How much of a SALE has come back — a different axis from its status, and
    // derived rather than stored, so it is expressed as EXISTS over the credit
    // notes rather than a column comparison.
    if (filters.refundState === LEDGER.REFUND_STATE.NONE) {
      where.push(`NOT EXISTS (SELECT 1 FROM transactiondetaillog cn
                               WHERE cn.ReversesLogId = l.Id AND cn.TenantId = l.TenantId AND cn.Active = 1)`);
    } else if (filters.refundState === LEDGER.REFUND_STATE.PARTIAL) {
      where.push(`(SELECT COALESCE(SUM(cn.GrossAmount), 0) FROM transactiondetaillog cn
                    WHERE cn.ReversesLogId = l.Id AND cn.TenantId = l.TenantId AND cn.Active = 1)
                  BETWEEN 0.01 AND l.GrossAmount - 0.01`);
    } else if (filters.refundState === LEDGER.REFUND_STATE.FULL) {
      where.push(`(SELECT COALESCE(SUM(cn.GrossAmount), 0) FROM transactiondetaillog cn
                    WHERE cn.ReversesLogId = l.Id AND cn.TenantId = l.TenantId AND cn.Active = 1)
                  >= l.GrossAmount - 0.01`);
    }
    if (filters.search) {
      where.push('(l.TransactionNo LIKE ? OR l.CustomerName LIKE ? OR l.CustomerMobile LIKE ?)');
      const like = `%${filters.search}%`;
      params.push(like, like, like);
    }
    const clause = where.length > 0 ? ` AND ${where.join(' AND ')}` : '';

    const [[{ total }]] = await conn.execute(
      `SELECT COUNT(*) AS total FROM transactiondetaillog l
         LEFT JOIN transactiontypestatus s ON s.Id = l.TransactionTypeStatusId
         LEFT JOIN transactiontype t ON t.Id = l.TransactionTypeId
        WHERE l.TenantId = ?${clause}`,
      params,
    );

    // LIMIT/OFFSET are numbers derived by calculatePagination, never user text.
    const [rows] = await conn.execute(
      `${QUERIES.LEDGER.SELECT_LOG_LIST}${clause} ORDER BY l.CreatedOn DESC LIMIT ${limitNum} OFFSET ${offset}`,
      params,
    );

    // How much has come back against each sale on this page.
    //
    // ONE grouped read for the whole page rather than a query per row: a ledger
    // list is fifty documents and an N+1 here would be fifty round trips to
    // render a column. The result is a map, so a document with no returns costs
    // nothing.
    const [returnedRows] = await conn.execute(
      QUERIES.LEDGER.SELECT_RETURNED_TOTALS_BULK, [tenantId],
    );
    const returnedBySale = new Map(
      (returnedRows || []).map((r) => [r.saleId, {
        returned: Number(r.returned || 0),
        noteCount: Number(r.noteCount || 0),
      }]),
    );

    return {
      // Same identification rule as the detail read, so a document cannot be
      // labelled one way in the list and another way when opened.
      data: rows.map((r) => {
        const back = returnedBySale.get(r.Id) || { returned: 0, noteCount: 0 };
        return {
          ...r,
          Source: describeSourceRow(r),
          // Staff see "₹500 of ₹1,240 returned" without opening anything.
          // GrossAmount is untouched: the original total is what the customer's
          // printed bill says, and a list that overwrote it with the net would
          // stop matching the paper.
          ReturnedAmount: back.returned,
          ReturnCount: back.noteCount,
          NetOfReturns: Number((Number(r.GrossAmount || 0) - back.returned).toFixed(2)),
          RefundState: refundState(r.GrossAmount, back.returned),
        };
      }),
      pagination: getPaginationMetadata(total, pageNum, limitNum),
    };
  });

/**
 * One document in full: header, lines (with variants and per-line tax), tenders,
 * and the transition history that proves how it got to its current status.
 */
const getDocument = (id, tenantId) =>
  withConnection(async (conn) => {
    const [logs] = await conn.execute(QUERIES.LEDGER.SELECT_LOG_FULL, [id, tenantId]);
    if (!logs || logs.length === 0) {
      throw new HttpError('Ledger document not found.', MESSAGES.HTTP_STATUS.NOT_FOUND);
    }
    const log = logs[0];

    const [lines] = await conn.execute(QUERIES.LEDGER.SELECT_LINES_BY_LOG, [id, tenantId]);
    const [tenders] = await conn.execute(QUERIES.LEDGER.SELECT_TENDERS_BY_LOG, [id, tenantId]);
    const [history] = await conn.execute(QUERIES.LEDGER.SELECT_TRANSITION_HISTORY, [id, tenantId]);
    // The rounds behind this invoice, and the token each was handed for. An
    // expense document has no POS bill, so this is legitimately empty rather
    // than an error.
    const [orders] = await conn.execute(QUERIES.LEDGER.SELECT_DOC_ORDERS, [id, tenantId]);

    // ── Returns ─────────────────────────────────────────────────────────────
    // Every credit note raised against this invoice, and how much of it has
    // come back. This is the difference between a screen that says "partly
    // refunded" and one that says exactly what happened, when, why and to
    // which tender.
    const [returnNotes] = await conn.execute(
      QUERIES.LEDGER.SELECT_RETURNS_BY_SALE, [id, tenantId],
    );
    const [[returnedRow]] = await conn.execute(
      QUERIES.LEDGER.SELECT_RETURNED_TOTAL, [id, tenantId],
    );
    const returnedAmount = Number(returnedRow?.returned || 0);

    // Per line, how much has already gone back — so the UI can render
    // "2 of 3 returned" against the line rather than mutating the quantity it
    // was sold at. Mutating it would make the document stop matching the
    // printed bill the customer is holding.
    const [returnedLines] = await conn.execute(
      QUERIES.LEDGER.SELECT_RETURNED_BY_LINE, [id, tenantId],
    );
    const returnedByLine = new Map(
      (returnedLines || []).map((r) => [r.SourceLineId, Number(r.returnedQty || 0)]),
    );

    return {
      ...log,
      TaxByComponent: parseJson(log.TaxByComponent) || [],
      Lines: lines.map((l) => ({
        ...l,
        TaxComponents: parseJson(l.TaxComponents) || [],
        Variants: parseJson(l.Variants) || [],
        // How many of this line have already come back.
        ReturnedQty: returnedByLine.get(l.Id) || 0,
      })),
      Tenders: tenders,
      History: history,

      // ── The returns picture ──────────────────────────────────────────────
      // GrossAmount is deliberately NOT reduced. The original total is what the
      // customer's printed bill says, and overwriting it with the net would make
      // the document stop matching the piece of paper in their hand. Returns and
      // Net ride alongside instead.
      ReturnedAmount: returnedAmount,
      NetOfReturns: Number((Number(log.GrossAmount || 0) - returnedAmount).toFixed(2)),
      RefundState: refundState(log.GrossAmount, returnedAmount),
      // Each note with its reason, amount and timestamp.
      Returns: returnNotes || [],
      // Each round with its token (if any) and the venue it was served at, so
      // the document can be traced back to the floor it came from.
      Orders: orders,
      // The customer-facing handle, resolved once here rather than by every
      // screen that renders a document. 'token' wins when one was issued: a
      // counter customer is holding a number, not a table.
      Source: describeSource(orders),
      // Null on a sale — only a credit note carries a reason.
      IsFault: log.ReturnReasonId ? !!log.IsFault : null,
      // Drives whether the UI offers any action at all.
      IsImmutable: LEDGER.IMMUTABLE_STATUSES.includes(log.StatusName),
    };
  });

/**
 * The returns register: every credit note, filtered however the business
 * happens to remember it.
 *
 * Its own read rather than a filter over listDocuments, because the two answer
 * different questions with different columns. The ledger asks "what documents
 * exist"; this asks "what came back, off what, for whom, why, to which tender,
 * and who did it" — and every one of those is a filter as well as a column,
 * because a register you cannot query by what you remember is one nobody uses.
 *
 * The totals are computed over the WHOLE filtered set, not the page: "₹6,240
 * returned this month" must not change when somebody turns the page.
 *
 * @param {Object} filters - see returnsListQuerySchema.
 */
const listReturns = (filters, page, limit, tenantId) =>
  withConnection(async (conn) => {
    const { pageNum, limitNum, offset } = calculatePagination(page, limit);

    const where = [];
    const params = [tenantId, LEDGER.TYPE_POS_RETURN];

    if (filters.fromDate) { where.push('l.TransactionDate >= ?'); params.push(filters.fromDate); }
    if (filters.toDate) { where.push('l.TransactionDate <= ?'); params.push(filters.toDate); }
    if (filters.branchId) { where.push('l.BranchId = ?'); params.push(filters.branchId); }
    if (filters.reasonId) { where.push('l.ReturnReasonId = ?'); params.push(filters.reasonId); }
    // Whether the reason means WE got it wrong. The split that turns a refund
    // register into a kitchen-quality signal.
    if (filters.isFault !== undefined) {
      where.push('COALESCE(rr.IsFault, 0) = ?');
      params.push(filters.isFault ? 1 : 0);
    }
    if (filters.settlementStatus) {
      // A note written before the column existed reads as PENDING rather than
      // dropping out of the worklist.
      where.push("COALESCE(l.SettlementStatus, 'PENDING') = ?");
      params.push(filters.settlementStatus);
    }
    if (filters.contactDetailId) { where.push('l.ContactDetailId = ?'); params.push(filters.contactDetailId); }
    if (filters.createdBy) { where.push('l.CreatedBy = ?'); params.push(filters.createdBy); }
    if (filters.minAmount !== undefined) { where.push('l.GrossAmount >= ?'); params.push(filters.minAmount); }
    if (filters.maxAmount !== undefined) { where.push('l.GrossAmount <= ?'); params.push(filters.maxAmount); }
    // WHICH DISH came back. EXISTS rather than a join: joining the lines would
    // fan a two-line note into two rows and double every total on the page.
    if (filters.itemId) {
      where.push(`EXISTS (SELECT 1 FROM transactionitemdetail ti
                           WHERE ti.TransactionDetailLogId = l.Id
                             AND ti.TenantId = l.TenantId AND ti.ItemId = ?)`);
      params.push(filters.itemId);
    }
    // Whatever they remember: the note number, the invoice it came off, or the
    // customer.
    if (filters.search) {
      where.push(`(l.TransactionNo LIKE ? OR orig.TransactionNo LIKE ?
                   OR l.CustomerName LIKE ? OR l.CustomerMobile LIKE ?)`);
      const like = `%${filters.search}%`;
      params.push(like, like, like, like);
    }

    const clause = where.length > 0 ? ` AND ${where.join(' AND ')}` : '';

    const [[{ total }]] = await conn.execute(
      `${QUERIES.LEDGER.COUNT_RETURNS_LIST}${clause}`, params,
    );
    const [[totals]] = await conn.execute(
      `${QUERIES.LEDGER.SUM_RETURNS_LIST}${clause}`, params,
    );

    // LIMIT/OFFSET are numbers from calculatePagination, never user text.
    const [rows] = await conn.execute(
      `${QUERIES.LEDGER.SELECT_RETURNS_LIST}${clause} ORDER BY l.CreatedOn DESC LIMIT ${limitNum} OFFSET ${offset}`,
      params,
    );

    return {
      data: rows.map((r) => ({
        ...r,
        IsFault: !!r.IsFault,
        // What proportion of the original invoice this note took back — the
        // figure that says "a whole meal" apart from "one side dish".
        ShareOfSale: Number(r.SaleGross) > 0
          ? Math.round((Number(r.GrossAmount) / Number(r.SaleGross)) * 10000) / 100
          : null,
      })),
      totals: {
        ReturnedAmount: Number(totals?.ReturnedAmount || 0),
        ReturnedNet: Number(totals?.ReturnedNet || 0),
        ReturnedTax: Number(totals?.ReturnedTax || 0),
        ReturnCount: Number(totals?.ReturnCount || 0),
        FaultAmount: Number(totals?.FaultAmount || 0),
      },
      pagination: getPaginationMetadata(total, pageNum, limitNum),
    };
  });

/**
 * Every credit note against one sale.
 *
 * Its own endpoint as well as part of getDocument, because the returns worklist
 * needs it without paying for a full document read.
 */
const listReturnsForSale = (saleId, tenantId) =>
  withConnection(async (conn) => {
    const [notes] = await conn.execute(QUERIES.LEDGER.SELECT_RETURNS_BY_SALE, [saleId, tenantId]);
    const [[totals]] = await conn.execute(QUERIES.LEDGER.SELECT_RETURNED_TOTAL, [saleId, tenantId]);
    return {
      Returns: notes || [],
      ReturnedAmount: Number(totals?.returned || 0),
      ReturnCount: Number(totals?.noteCount || 0),
    };
  });

/**
 * Refunds recorded but not yet handed over.
 *
 * Empty in normal operation today — a till refund is instant — which is exactly
 * why the shape exists now: the moment a payment gateway makes a refund
 * asynchronous, this is the queue somebody has to work, and adding it then
 * would mean reshaping documents already written without it.
 */
const pendingSettlements = (tenantId) =>
  withConnection(async (conn) => {
    const [rows] = await conn.execute(
      QUERIES.LEDGER.SELECT_PENDING_SETTLEMENTS, [tenantId, LEDGER.TYPE_POS_RETURN],
    );
    return rows || [];
  });

/** Mark a refund as actually paid out, failed, or back to pending. */
const setSettlementStatus = (noteId, body, tenantId, userPhone) =>
  withConnection(async (conn) => {
    const [result] = await conn.execute(QUERIES.LEDGER.SET_SETTLEMENT_STATUS, [
      body.SettlementStatus, body.SettlementRef || null, userPhone, noteId, tenantId,
    ]);
    if (!result.affectedRows) {
      throw new HttpError('Credit note not found.', MESSAGES.HTTP_STATUS.NOT_FOUND);
    }
    return { Id: noteId, SettlementStatus: body.SettlementStatus };
  });

module.exports = {
  listDocuments,
  getDocument,
  listReturns,
  listReturnsForSale,
  pendingSettlements,
  setSettlementStatus,
};
