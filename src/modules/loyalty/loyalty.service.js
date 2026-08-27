// src/modules/loyalty/loyalty.service.js
//
// Loyalty points, as a ledger rather than a counter.
//
// WHY IT IS A LEDGER
// pos_customer.LoyaltyPoints used to be a bare number. It could say 240 and
// nothing could say why; a customer disputing it had no evidence to be shown;
// and — the reason this module exists — a refund could not give points back,
// because there was no record of what the sale had given in the first place.
//
// So points move the way money already moves in this system: append a row,
// never overwrite one. The balance is SUM(Points), and the column on
// pos_customer becomes a cache of that sum for the till, which cannot afford to
// aggregate a year of history at the counter. Exactly what Visits and
// TotalSpent already are, and documented as such on the table.
//
// EVERYTHING HERE TAKES A CONNECTION
// Earning happens inside the settle transaction and reversing inside the refund
// transaction, on purpose: a sale that rolls back must take its points with it.
// A customer credited for a sale that never happened is worse than one who was
// never credited.

const { v4: uuidv4 } = require('uuid');
const { withConnection } = require('../../utils/dbHelper');
const { QUERIES, LOYALTY } = require('../../config/constants');
const { logger } = require('../../utils/logger');

const { ENTRY, SOURCE } = LOYALTY;

/**
 * The rate one point costs, for this tenancy.
 *
 * Read from pos_setting — the same per-tenant mechanism token numbering uses —
 * falling back to the constant. It was only ever a constant because nothing had
 * asked for a second rate yet; a platform with more than one tenant needs one.
 *
 * @param {Object} conn
 * @param {string} tenantId
 * @returns {Promise<number>} Rupees per point. Never zero — that would divide by nothing.
 */
const resolveRate = async (conn, tenantId) => {
  try {
    const [rows] = await conn.execute(
      QUERIES.POS_SETTING.SELECT_VALUE_FOR_TENANT, [tenantId, LOYALTY.SETTING_KEY],
    );
    const configured = Number(rows[0]?.SettingValue);
    if (configured > 0) return configured;
  } catch (err) {
    // A missing setting is not a reason to fail a sale. The fallback is the
    // behaviour every tenant had until this line existed.
    logger.debug('Loyalty rate lookup failed; using the default', { tenantId });
  }
  return LOYALTY.RUPEES_PER_POINT;
};

/**
 * Append one movement. The only way points ever change.
 *
 * @param {Object} conn - Active TRANSACTION connection.
 * @param {Object} entry - { customerId, entryType, points, sourceType, sourceId, reversesId, reason, branchDetailId }
 * @param {string} tenantId
 * @param {string} userEmail
 * @returns {Promise<{id: string, points: number}|null>} Null when the guard rejected a duplicate.
 */
const appendTx = async (conn, entry, tenantId, userEmail) => {
  const id = uuidv4();
  try {
    await conn.execute(QUERIES.LOYALTY_LEDGER.INSERT, [
      id, tenantId, entry.customerId, entry.entryType, entry.points,
      entry.sourceType || null, entry.sourceId || null, entry.reversesId || null,
      entry.reason || null, entry.branchDetailId || null, userEmail,
    ]);
  } catch (err) {
    // UNIQUE (tenant, source, type). A retried settle or a double-clicked
    // refund lands here, and the right answer is "already done", not an error
    // that fails a paid sale.
    if (err.code === 'ER_DUP_ENTRY') {
      logger.info('Loyalty entry already recorded for this source', {
        sourceType: entry.sourceType, sourceId: entry.sourceId, entryType: entry.entryType,
      });
      return null;
    }
    throw err;
  }

  // The cache on pos_customer. Moved only here, so it cannot drift from the
  // ledger by any path that does not go through this function.
  await conn.execute(QUERIES.POS_CUSTOMER.ADJUST_POINTS, [
    entry.points, userEmail, entry.customerId, tenantId,
  ]);

  return { id, points: entry.points };
};

/**
 * Credit the points a settled sale earned.
 *
 * @param {Object} conn - The settle transaction's connection.
 * @param {Object} sale - { customerId, billId, amount, branchDetailId }
 * @param {string} tenantId
 * @param {string} userEmail
 * @returns {Promise<number>} Points credited. Zero for a walk-in.
 */
const earnForSaleTx = async (conn, sale, tenantId, userEmail) => {
  if (!sale.customerId) return 0;                 // walk-in: nothing to record

  const spend = Number(sale.amount) || 0;
  if (spend <= 0) return 0;

  const rate = await resolveRate(conn, tenantId);
  // Whole points only. Rounding up would let a ₹1 sale mint a point.
  const points = Math.floor(spend / rate);
  if (points <= 0) return 0;

  const entry = await appendTx(conn, {
    customerId: sale.customerId,
    entryType: ENTRY.EARN,
    points,
    sourceType: SOURCE.BILL,
    sourceId: sale.billId,
    reason: `Earned on a sale of ${spend}`,
    branchDetailId: sale.branchDetailId,
  }, tenantId, userEmail);

  return entry ? points : 0;
};

/**
 * Take back the points a refunded sale gave.
 *
 * Reverses BY THE ORIGINAL ENTRY, not by recomputing from the amount. If the
 * tenancy changed its earn rate between the sale and the refund, recomputing
 * would claw back a different number than was given — and the customer would be
 * right to complain. The reversal names the entry it undoes.
 *
 * @param {Object} conn - The refund transaction's connection.
 * @param {Object} refund - { billId, reason, branchDetailId }
 * @param {string} tenantId
 * @param {string} userEmail
 * @returns {Promise<number>} Points taken back, as a positive number. Zero if there were none.
 */
const reverseForSaleTx = async (conn, refund, tenantId, userEmail) => {
  const [rows] = await conn.execute(QUERIES.LOYALTY_LEDGER.SELECT_ENTRY_BY_SOURCE, [
    tenantId, SOURCE.BILL, refund.billId, ENTRY.EARN,
  ]);
  const original = rows[0];
  // No earn to reverse: a walk-in sale, or one settled before this existed.
  if (!original || Number(original.Points) <= 0) return 0;

  const entry = await appendTx(conn, {
    customerId: original.CustomerId,
    entryType: ENTRY.REVERSAL,
    points: -Number(original.Points),
    sourceType: SOURCE.BILL,
    sourceId: refund.billId,
    reversesId: original.Id,
    reason: refund.reason
      ? `Refunded — ${String(refund.reason).slice(0, 200)}`
      : 'Refunded',
    branchDetailId: refund.branchDetailId,
  }, tenantId, userEmail);

  return entry ? Number(original.Points) : 0;
};

/**
 * Claw back the points a PARTIAL return should take — and no more.
 *
 * ── Why this is not reverseForSaleTx with a number ──────────────────────────
 * That one reverses the entire original EARN whatever came back, which is right
 * for a full refund and wrong for every partial one. It is also keyed on the
 * BILL, and the ledger's UNIQUE (TenantId, SourceType, SourceId, EntryType)
 * then rejects the SECOND partial return against the same bill outright — the
 * constraint is well-motivated (it is what stops a dropped response clawing
 * back twice), so the fix is to give each return its own source rather than to
 * weaken the key.
 *
 * So: keyed on the CREDIT NOTE. Each return is legitimately its own source, the
 * key still stops a replayed request double-clawing, and partial returns can
 * accumulate.
 *
 * ── The true-up ────────────────────────────────────────────────────────────
 * Proportional shares round. Three returns of a third each at 100 points give
 * 33 + 33 + 33 = 99, leaving a point that was granted and never taken back. On
 * the FINAL return — the one that completes the sale — the remainder is taken
 * instead of the proportion, so a sequence of partial returns reverses exactly
 * what was granted and never one point more.
 *
 * @param {Object} conn - The refund transaction's connection.
 * @param {Object} ret
 * @param {string} ret.billId          - The bill whose EARN is being reversed.
 * @param {string} ret.returnLogId     - The credit note. Becomes SourceId.
 * @param {number} ret.returnedAmount  - Value coming back on THIS return.
 * @param {number} ret.originalAmount  - The sale's gross.
 * @param {boolean} ret.isFinal        - Does this return complete the sale?
 * @returns {Promise<number>} Points actually reversed (a positive number).
 */
const reverseForReturnTx = async (conn, ret, tenantId, userEmail) => {
  const [rows] = await conn.execute(QUERIES.LOYALTY_LEDGER.SELECT_ENTRY_BY_SOURCE, [
    tenantId, SOURCE.BILL, ret.billId, ENTRY.EARN,
  ]);
  const original = rows[0];
  // No earn to reverse: a walk-in sale, or one settled before loyalty existed.
  if (!original || Number(original.Points) <= 0) return 0;

  const earned = Number(original.Points);

  // Everything already clawed back against this bill, however many returns ago.
  const [[prior]] = await conn.execute(
    `SELECT COALESCE(SUM(-Points), 0) AS reversed
       FROM pos_loyalty_ledger
      WHERE TenantId = ? AND CustomerId = ? AND EntryType = ? AND ReversesId = ?`,
    [tenantId, original.CustomerId, ENTRY.REVERSAL, original.Id],
  );
  const alreadyReversed = Number(prior?.reversed || 0);
  const outstanding = Math.max(0, earned - alreadyReversed);
  if (outstanding === 0) return 0;

  const originalAmount = Number(ret.originalAmount) || 0;
  const returnedAmount = Number(ret.returnedAmount) || 0;

  // The final return takes whatever is left, so rounding never strands a point.
  const wanted = ret.isFinal || originalAmount <= 0
    ? outstanding
    : Math.round((earned * returnedAmount) / originalAmount);

  const points = Math.min(wanted, outstanding);
  if (points <= 0) return 0;

  const entry = await appendTx(conn, {
    customerId: original.CustomerId,
    entryType: ENTRY.REVERSAL,
    points: -points,
    // The CREDIT NOTE, not the bill — see the note above.
    sourceType: SOURCE.RETURN,
    sourceId: ret.returnLogId,
    reversesId: original.Id,
    reason: ret.reason
      ? `Returned — ${String(ret.reason).slice(0, 200)}`
      : 'Returned',
    branchDetailId: ret.branchDetailId,
  }, tenantId, userEmail);

  return entry ? points : 0;
};

/**
 * Spend points against a sale.
 *
 * Not yet reachable from the till — the redemption control is the next slice —
 * but the guards belong with the ledger rather than with whatever calls it.
 *
 * @param {Object} conn - The settle transaction's connection.
 * @param {Object} spend - { customerId, billId, points, maxValue, branchDetailId }
 * @param {string} tenantId
 * @param {string} userEmail
 * @returns {Promise<number>} Points actually spent.
 */
const redeemForSaleTx = async (conn, spend, tenantId, userEmail) => {
  const wanted = Math.floor(Number(spend.points) || 0);
  if (!spend.customerId || wanted <= 0) return 0;

  // Locked: two tills settling for the same customer at the same moment would
  // otherwise both see the balance and both spend it.
  const [rows] = await conn.execute(
    QUERIES.LOYALTY_LEDGER.SELECT_BALANCE_FOR_UPDATE, [spend.customerId, tenantId],
  );
  const balance = Number(rows[0]?.balance || 0);

  // Capped twice: at what they have, and at what the sale is worth. A discount
  // larger than the bill would turn a customer into a creditor.
  const capped = Math.min(wanted, balance, Math.floor(Number(spend.maxValue) || 0));
  if (capped <= 0) return 0;

  const entry = await appendTx(conn, {
    customerId: spend.customerId,
    entryType: ENTRY.REDEEM,
    points: -capped,
    sourceType: SOURCE.BILL,
    sourceId: spend.billId,
    reason: `Redeemed against a sale`,
    branchDetailId: spend.branchDetailId,
  }, tenantId, userEmail);

  return entry ? capped : 0;
};

/**
 * Grant or deduct points by hand — a goodwill gesture, a correction, a campaign.
 *
 * @param {Object} adjustment - { customerId, points, reason }
 * @param {string} tenantId
 * @param {string} userEmail
 * @returns {Promise<{points: number, balance: number}>}
 */
const adjust = ({ customerId, points, reason }, tenantId, userEmail) =>
  withConnection(async (conn) => {
    await appendTx(conn, {
      customerId,
      entryType: ENTRY.ADJUSTMENT,
      points: Math.trunc(Number(points) || 0),
      sourceType: SOURCE.MANUAL,
      // Unique per (source, type), so a manual adjustment needs its own id or a
      // second gesture for the same customer would be rejected as a duplicate.
      sourceId: uuidv4(),
      reason,
    }, tenantId, userEmail);

    const [rows] = await conn.execute(
      QUERIES.LOYALTY_LEDGER.SELECT_BALANCE, [customerId, tenantId],
    );
    return { points: Math.trunc(Number(points) || 0), balance: Number(rows[0]?.balance || 0) };
  });

/**
 * What a customer has, and how they came to have it.
 *
 * @param {string} customerId
 * @param {string} tenantId
 * @returns {Promise<{balance: number, entries: Array}>}
 */
const getStatement = (customerId, tenantId) =>
  withConnection(async (conn) => {
    const [[balanceRow]] = await conn.execute(
      QUERIES.LOYALTY_LEDGER.SELECT_BALANCE, [customerId, tenantId],
    );
    const [entries] = await conn.execute(
      QUERIES.LOYALTY_LEDGER.SELECT_STATEMENT, [customerId, tenantId],
    );
    return { balance: Number(balanceRow?.balance || 0), entries };
  });

module.exports = {
  earnForSaleTx,
  reverseForSaleTx,
  reverseForReturnTx,
  redeemForSaleTx,
  adjust,
  getStatement,
  resolveRate,
};
