// src/modules/ledger/ledger.read.service.js
// Read side of the ledger — the accountant's view.
//
// Strictly read-only by design. A settled document is corrected by refund, never
// by editing, so there is deliberately no update path here.

const { withConnection } = require('../../utils/dbHelper');
const { QUERIES, LEDGER } = require('../../config/constants');
const { HttpError } = require('../../middleware/errorHandler');
const MESSAGES = require('../../config/messages');
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
    if (filters.search) {
      where.push('(l.TransactionNo LIKE ? OR l.CustomerName LIKE ? OR l.CustomerMobile LIKE ?)');
      const like = `%${filters.search}%`;
      params.push(like, like, like);
    }
    const clause = where.length > 0 ? ` AND ${where.join(' AND ')}` : '';

    const [[{ total }]] = await conn.execute(
      `SELECT COUNT(*) AS total FROM transactiondetaillog l
         LEFT JOIN transactiontypestatus s ON s.Id = l.TransactionTypeStatusId
        WHERE l.TenantId = ?${clause}`,
      params,
    );

    // LIMIT/OFFSET are numbers derived by calculatePagination, never user text.
    const [rows] = await conn.execute(
      `${QUERIES.LEDGER.SELECT_LOG_LIST}${clause} ORDER BY l.CreatedOn DESC LIMIT ${limitNum} OFFSET ${offset}`,
      params,
    );

    return { data: rows, pagination: getPaginationMetadata(total, pageNum, limitNum) };
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

    return {
      ...log,
      TaxByComponent: parseJson(log.TaxByComponent) || [],
      Lines: lines.map((l) => ({
        ...l,
        TaxComponents: parseJson(l.TaxComponents) || [],
        Variants: parseJson(l.Variants) || [],
      })),
      Tenders: tenders,
      History: history,
      // Drives whether the UI offers any action at all.
      IsImmutable: LEDGER.IMMUTABLE_STATUSES.includes(log.StatusName),
    };
  });

module.exports = { listDocuments, getDocument };
