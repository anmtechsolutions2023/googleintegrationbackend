// src/modules/postoken/postoken.service.js
// POS Token service — the counter-service queue.
//
// A token is the customer-facing handle for an order taken at the counter,
// where there is no table to anchor it to. It is minted HERE, on the server,
// inside the transaction that settles the bill. It used to be minted in the
// browser as Math.max(...loadedTokens) + 1, which is the same defect already
// fixed for OrderNo and KotNo: two tills issue #7 at once, and with
// BranchDetailId left NULL the unique key could not even catch it (MySQL treats
// NULLs as distinct in a unique index).

const BaseCRUDService = require('../../common/BaseCRUDService');
const {
  QUERIES,
  TOKEN_NUMBERING,
  POS_TOKEN_SERIES,
  POS_TOKEN_STATUSES,
} = require('../../config/constants');
const { withConnection, withTransaction } = require('../../utils/dbHelper');
const {
  calculatePagination,
  getPaginationMetadata,
  extractCount,
} = require('../../utils/paginationHelper');
const { HttpError } = require('../../middleware/errorHandler');
const settingService = require('../possetting/possetting.service');
const numberService = require('../ledger/transactionNumber.service');
const { logger } = require('../../utils/logger');
const { businessDate } = require('../../utils/dateRange');

/**
 * Today, as the DATE column stores it.
 *
 * Delegates to the shared businessDate so the queue and the accounts resolve
 * ONE definition of which day it is. These were UTC while every report reads
 * the local calendar, which in UTC+5:30 filed anything issued before 05:30
 * under the previous day — the Channels tab could show counter revenue for
 * today beside a queue that reported none.
 */
const todayIso = () => businessDate();

/**
 * Next number from the branch's per-day counter, taken under a row lock.
 *
 * The lock is what serialises two tills; UNIQUE (TenantId, BranchDetailId,
 * TokenDate, TokenNumber) on pos_token is the backstop if it ever fails.
 * MUST run inside a transaction — outside one the lock is released immediately
 * and buys nothing.
 *
 * @returns {Promise<number>}
 */
const nextDailyNumberTx = async (conn, branchId, tokenDate, tenantId, userEmail) => {
  const [rows] = await conn.execute(QUERIES.POS_TOKEN_COUNTER.SELECT_FOR_UPDATE, [
    tenantId, branchId, tokenDate,
  ]);

  if (rows.length === 0) {
    await conn.execute(QUERIES.POS_TOKEN_COUNTER.INSERT, [
      tenantId, branchId, tokenDate, 1, userEmail,
    ]);
    return 1;
  }

  const next = (Number(rows[0].LastNumber) || 0) + 1;
  await conn.execute(QUERIES.POS_TOKEN_COUNTER.UPDATE, [
    next, userEmail, tenantId, branchId, tokenDate,
  ]);
  return next;
};

/**
 * Next number from the tenant's POS_TOKEN series, or null when unconfigured.
 *
 * Uses issueNumber directly rather than posNumbering.issuePosNumber because
 * this needs BOTH halves — the rendered label AND the counter behind it — and
 * because that helper's fallback is a uuid fragment (TOK-3F9A21B0), which is
 * unusable as a number somebody has to call across a counter.
 *
 * @returns {Promise<{number:number, label:string}|null>}
 */
const nextSeriesNumberTx = async (conn, tenantId, userEmail) => {
  const [configs] = await conn.execute(QUERIES.LEDGER.SELECT_CONFIG_BY_TAG, [
    POS_TOKEN_SERIES.TAG, tenantId,
  ]);
  if (!Array.isArray(configs) || configs.length === 0 || !configs[0]?.Id) return null;

  const { transactionNo, counter } = await numberService.issueNumber(
    conn, configs[0].Id, tenantId, userEmail,
  );
  return { number: counter, label: transactionNo };
};

class PosTokenService extends BaseCRUDService {
  constructor() {
    super('POS Token', QUERIES.POS_TOKEN);
  }

  /**
   * Issue a token on a caller-supplied transaction connection.
   *
   * Called from the settle path so payment and token are one atomic act: a
   * dropped follow-up request cannot leave a paying customer with no number.
   *
   * @param {Object} conn - Open TRANSACTION connection.
   * @param {Object} p
   * @param {string} p.branchId - Required: the queue the token belongs to.
   * @param {string} [p.orderId] - The order behind the token, when there is one.
   * @param {string} tenantId
   * @param {string} userEmail
   * @returns {Promise<{id:string, TokenNumber:number, TokenLabel:string, TokenDate:string}>}
   */
  async issueTokenTx(conn, { branchId, orderId = null }, tenantId, userEmail) {
    if (!branchId) {
      throw new HttpError(
        'A counter token needs a branch — it belongs to one queue.',
        400,
      );
    }

    const tokenDate = todayIso();
    const mode = await settingService.resolveTokenNumberingTx(conn, branchId, tenantId);

    let issued = null;
    if (mode === TOKEN_NUMBERING.SERIES) {
      issued = await nextSeriesNumberTx(conn, tenantId, userEmail);
      // Configured for a series the tenant does not have. Counting from the
      // day's counter instead keeps the queue working; refusing to number a
      // paid order would be a worse outcome than the misconfiguration.
      if (!issued) {
        logger.warn('No POS_TOKEN series for tenant — falling back to daily numbering', {
          tenantId, branchId,
        });
      }
    }
    if (!issued) {
      const number = await nextDailyNumberTx(conn, branchId, tokenDate, tenantId, userEmail);
      issued = { number, label: String(number) };
    }

    // createTx returns { id, ...data }, which is the whole token row — the
    // caller needs the label to show it and the id to advance it.
    return this.createTx(
      conn,
      {
        TokenNumber: issued.number,
        TokenLabel: issued.label,
        TokenDate: tokenDate,
        OrderId: orderId,
        Status: 'waiting',
        BranchDetailId: branchId,
      },
      tenantId,
      userEmail,
    );
  }

  /** Manual issue (a walk-in with no order yet) — same minting path. */
  async create(data, tenantId, userEmail) {
    return withTransaction(async (conn) => {
      const created = await this.issueTokenTx(
        conn,
        { branchId: data.BranchDetailId, orderId: data.OrderId ?? null },
        tenantId,
        userEmail,
      );
      return { ...data, ...created };
    });
  }

  /**
   * The queue, filtered.
   *
   * Filtering server-side is the point: the screen used to pull every token the
   * tenant had ever issued and keep today's in the browser, which stops working
   * on the first busy week. Falls through to the base implementation when no
   * filter is given so existing callers are untouched.
   *
   * @param {Object} [filters] - { branchId, date, status }
   */
  async getAll(tenantId, page = 1, limit = 10, filters = {}) {
    const { branchId, date, status } = filters || {};
    if (!branchId && !date && !status) return super.getAll(tenantId, page, limit);

    const { pageNum, limitNum, offset } = calculatePagination(page, limit);
    const where = ['t.TenantId = ?'];
    const params = [tenantId];
    if (branchId) { where.push('t.BranchDetailId = ?'); params.push(branchId); }
    if (date)     { where.push('t.TokenDate = ?');      params.push(date); }
    if (status)   { where.push('t.Status = ?');         params.push(status); }
    const clause = where.join(' AND ');

    return withConnection(async (conn) => {
      const [countRows] = await conn.execute(
        `SELECT COUNT(*) as total FROM pos_token t WHERE ${clause}`, params,
      );
      const [rows] = await conn.execute(
        `SELECT t.*, o.OrderNo, o.Total AS OrderTotal, o.Items AS OrderItems
           FROM pos_token t
           LEFT JOIN pos_order o ON o.Id = t.OrderId
          WHERE ${clause}
          ORDER BY t.TokenDate DESC, t.TokenNumber DESC
          LIMIT ${limitNum} OFFSET ${offset}`,
        params,
      );
      return {
        data: rows,
        pagination: getPaginationMetadata(extractCount(countRows), pageNum, limitNum),
      };
    });
  }

  /**
   * Domain action: advance the queue (call / serve / cancel).
   * CalledAt and ServedAt are stamped by the query, once each — a recall must
   * not overwrite when the customer was first called.
   */
  async setStatus(id, tenantId, userEmail, status) {
    if (!POS_TOKEN_STATUSES.includes(status)) {
      throw new HttpError(`Unknown token status '${status}'.`, 400);
    }
    return withConnection(async (conn) => {
      await this.getById(id, tenantId); // 404 if missing (reuses base + HttpError)
      await conn.execute(this.queries.SET_STATUS, [
        status, status, status, userEmail, id, tenantId,
      ]);
      return this.getById(id, tenantId);
    });
  }

  prepareInsertParams(id, data, tenantId, userEmail) {
    return [
      id,
      tenantId,
      data.TokenNumber ?? null,
      data.TokenLabel ?? String(data.TokenNumber ?? ''),
      data.TokenDate ?? todayIso(),
      data.OrderId ?? null,
      data.Status ?? 'waiting',
      data.CalledAt ?? null,
      data.ServedAt ?? null,
      data.BranchDetailId ?? null,
      data.Active !== undefined ? data.Active : true,
      userEmail,
      userEmail,
    ];
  }

  prepareUpdateParams(data, existing, userEmail, id, tenantId) {
    return [
      data.TokenNumber !== undefined ? data.TokenNumber : existing.TokenNumber,
      data.TokenLabel !== undefined ? data.TokenLabel : existing.TokenLabel,
      data.TokenDate !== undefined ? data.TokenDate : existing.TokenDate,
      data.OrderId !== undefined ? data.OrderId : existing.OrderId,
      data.Status !== undefined ? data.Status : existing.Status,
      data.CalledAt !== undefined ? data.CalledAt : existing.CalledAt,
      data.ServedAt !== undefined ? data.ServedAt : existing.ServedAt,
      data.BranchDetailId !== undefined ? data.BranchDetailId : existing.BranchDetailId,
      data.Active !== undefined ? data.Active : existing.Active,
      userEmail,
      id,
      tenantId,
    ];
  }
}

const service = new PosTokenService();

module.exports = {
  getAll: (tenantId, page, limit, filters) => service.getAll(tenantId, page, limit, filters),
  getById: (id, tenantId) => service.getById(id, tenantId),
  create: (data, tenantId, userEmail) => service.create(data, tenantId, userEmail),
  update: (id, data, tenantId, userEmail) => service.update(id, data, tenantId, userEmail),
  remove: (id, tenantId) => service.delete(id, tenantId),
  // Domain actions — the queue advancing, not a field being edited.
  call: (id, tenantId, userEmail) => service.setStatus(id, tenantId, userEmail, 'called'),
  serve: (id, tenantId, userEmail) => service.setStatus(id, tenantId, userEmail, 'served'),
  // Used by the settle path, on its own transaction.
  issueTokenTx: (conn, params, tenantId, userEmail) =>
    service.issueTokenTx(conn, params, tenantId, userEmail),
};
