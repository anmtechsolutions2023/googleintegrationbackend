// src/modules/poscashsession/poscashsession.service.js
// Cash sessions — a cashier's shift at a till, and the day-close that reconciles
// it.
//
// Granularity is per shift per cashier, not per day: two people on one till in
// one day are two accountabilities, and a single daily row could not say whose
// count was short.
//
// Expected cash is DERIVED, never stored as it goes:
//     expected = opening float + every Cash movement in the session's window
// and those movements are already rows in `paymentbreakup` — sales positive,
// expenses and refunds negative. Nothing needs to be tallied as it happens,
// which is what keeps a sale from failing because a till was not opened.

const { v4: uuidv4 } = require('uuid');
const BaseCRUDService = require('../../common/BaseCRUDService');
const { QUERIES, CASH_SESSION_STATUS } = require('../../config/constants');
const { withTransaction } = require('../../utils/dbHelper');
const { HttpError } = require('../../middleware/errorHandler');
const MESSAGES = require('../../config/messages');
const { toMinor, fromMinor } = require('../../utils/taxCalculator');

class PosCashSessionService extends BaseCRUDService {
  constructor() {
    super('Cash Session', QUERIES.POS_CASH_SESSION);
  }

  /**
   * Opens a till for a cashier at a branch.
   *
   * @param {Object} data - { BranchDetailId, CashierPhone?, ShiftLabel?, OpeningFloat? }
   * @param {string} tenantId
   * @param {string} userPhone - Whoever opened it; the default cashier.
   */
  async open(data, tenantId, userPhone) {
    return withTransaction(async (conn) => {
      const cashier = data.CashierPhone || userPhone;

      // One open till per cashier per branch. Checked here rather than by a
      // UNIQUE key because MySQL treats every NULL ClosedAt as distinct, so the
      // constraint cannot be expressed in the schema.
      const [open] = await conn.execute(this.queries.SELECT_OPEN_FOR_CASHIER, [
        tenantId, data.BranchDetailId, cashier,
      ]);
      if (open.length > 0) {
        throw new HttpError(
          MESSAGES.ERROR.CASH_SESSION_ALREADY_OPEN,
          MESSAGES.HTTP_STATUS.CONFLICT,
        );
      }

      const id = uuidv4();
      await conn.execute(this.queries.INSERT, [
        id, tenantId, data.BranchDetailId, cashier,
        data.ShiftLabel ?? null, data.OpeningFloat ?? 0,
        userPhone, CASH_SESSION_STATUS.OPEN, userPhone, userPhone,
      ]);
      // Read back on the SAME connection: a pooled read would sit outside this
      // transaction and 404 on the row we just inserted.
      return this.getByIdTx(conn, id, tenantId);
    });
  }

  /**
   * What the drawer SHOULD hold right now: opening float plus every cash
   * movement at this branch since the till opened.
   *
   * @param {Object} conn
   * @param {Object} session
   * @param {string} tenantId
   * @returns {Promise<number>}
   */
  async expectedCash(conn, session, tenantId) {
    const until = session.ClosedAt || new Date();
    const [[movement]] = await conn.execute(QUERIES.LEDGER_REPORT.SESSION_CASH_MOVEMENT, [
      tenantId,
      session.BranchDetailId,
      session.BranchDetailId,
      session.OpenedAt,
      until,
    ]);
    return fromMinor(toMinor(session.OpeningFloat) + toMinor(movement?.NetCash || 0));
  }

  /**
   * Closes a till and records the variance.
   *
   * The counted figure is not corrected to match the expectation — the whole
   * point is that the difference is visible and has to be explained.
   *
   * @param {string} id
   * @param {Object} data - { CountedCash, Notes? }
   * @param {string} tenantId
   * @param {string} userPhone
   */
  async close(id, data, tenantId, userPhone) {
    return withTransaction(async (conn) => {
      const [rows] = await conn.execute(this.queries.SELECT_OPEN_BY_ID, [id, tenantId]);
      if (rows.length === 0) {
        throw new HttpError(
          MESSAGES.ERROR.CASH_SESSION_NOT_OPEN,
          MESSAGES.HTTP_STATUS.CONFLICT,
        );
      }
      const session = rows[0];

      const expected = await this.expectedCash(conn, session, tenantId);
      const counted = Number(data.CountedCash) || 0;
      const variance = fromMinor(toMinor(counted) - toMinor(expected));

      // The Status = 'open' predicate in CLOSE is the concurrency guard: two
      // simultaneous closes cannot both write a variance.
      const [result] = await conn.execute(this.queries.CLOSE, [
        userPhone, counted, expected, variance, data.Notes ?? null,
        userPhone, id, tenantId,
      ]);
      if (result.affectedRows === 0) {
        throw new HttpError(
          MESSAGES.ERROR.CASH_SESSION_NOT_OPEN,
          MESSAGES.HTTP_STATUS.CONFLICT,
        );
      }

      return this.getByIdTx(conn, id, tenantId);
    });
  }

  /**
   * A live view of an open till, without closing it — what a manager checks
   * mid-shift.
   */
  async summary(id, tenantId) {
    return withTransaction(async (conn) => {
      const session = await this.getByIdTx(conn, id, tenantId);
      const expected = await this.expectedCash(conn, session, tenantId);
      return {
        ...session,
        ExpectedCash: session.Status === CASH_SESSION_STATUS.CLOSED
          ? Number(session.ExpectedCash || 0)
          : expected,
        IsOpen: session.Status === CASH_SESSION_STATUS.OPEN,
      };
    });
  }
}

const service = new PosCashSessionService();

module.exports = {
  getAll: (tenantId, page, limit) => service.getAll(tenantId, page, limit),
  getById: (id, tenantId) => service.getById(id, tenantId),
  open: (data, tenantId, userPhone) => service.open(data, tenantId, userPhone),
  close: (id, data, tenantId, userPhone) => service.close(id, data, tenantId, userPhone),
  summary: (id, tenantId) => service.summary(id, tenantId),
  // Exported on its own: the derivation is the interesting part, and the
  // day-close report needs it without closing anything.
  expectedCash: (conn, session, tenantId) => service.expectedCash(conn, session, tenantId),
};
