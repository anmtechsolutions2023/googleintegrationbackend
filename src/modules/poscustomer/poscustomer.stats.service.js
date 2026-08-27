// src/modules/poscustomer/poscustomer.stats.service.js
// The CRM projection: visits, spend and loyalty points on pos_customer.
//
// These three columns have existed since the table was created and NOTHING has
// ever written them — every customer has read 0 visits and ₹0 spent no matter
// how often they came in.
//
// They are a PROJECTION, not a source of truth. The ledger remains the record
// of what was sold; this is the answer a till needs at the counter without
// aggregating a year of documents while somebody waits. That is also why the
// migration can rebuild them from the documents at any time.
//
// Lives in the CRM module rather than inside posbill.settle: what a sale does
// to a customer's history is a CRM concern, and the bill service should not
// grow a second job. settle calls in; nothing here knows how a bill is built.

const { QUERIES } = require('../../config/constants');
const { logger } = require('../../utils/logger');

/**
 * Records a settled sale against a customer.
 *
 * Increments rather than recomputing: the live path runs inside the settle
 * transaction and must stay cheap, and an increment cannot scan. Because these
 * columns are a projection, they can always be rebuilt from the ledger if the
 * two ever need reconciling — the documents remain the record of what was sold.
 *
 * MUST run on the settle transaction's own connection: if the sale rolls back,
 * the visit it recorded has to roll back with it. A customer credited for a
 * sale that never happened is worse than one who was never credited.
 *
 * @param {Object} conn - Open TRANSACTION connection.
 * @param {string|null} customerId - Null for a walk-in; nothing to record.
 * @param {number} amount - What the sale settled for.
 * @param {string} tenantId
 * @param {string} userEmail
 * @returns {Promise<boolean>} Whether anything was recorded.
 */
const recordSaleTx = async (conn, customerId, amount, tenantId, userEmail) => {
  if (!customerId) return false;

  const spend = Number(amount) || 0;
  // Points are no longer moved here. They go through the loyalty ledger, which
  // records WHY a balance changed — the thing a bare counter could never say,
  // and the reason a refund used to have nothing to give back.
  const [result] = await conn.execute(QUERIES.POS_CUSTOMER.RECORD_SALE, [
    spend, userEmail, customerId, tenantId,
  ]);

  if (!result.affectedRows) {
    // The order named a customer who is not in this tenant. Worth knowing
    // about, but not worth failing a paid sale over.
    logger.warn('Sale settled against an unknown customer — no CRM update', {
      customerId, tenantId,
    });
    return false;
  }
  return true;
};

/**
 * Takes a settled sale back off a customer's record when it is refunded.
 *
 * The other half of recordSaleTx, and it did not exist: settling credited a
 * visit, spend and points, and refunding reversed the accounting ledger while
 * leaving all three standing. A ₹10,000 sale could be settled, refunded, and
 * still leave the customer a visit richer and 100 points up — points that
 * nothing spent yet, which is the only reason it had not been noticed.
 *
 * Floors at zero rather than going negative: a projection that has drifted must
 * not be driven below zero by a correction.
 *
 * MUST run on the refund transaction's own connection, for the same reason
 * recordSaleTx runs on the settle one.
 *
 * @param {Object} conn - Open TRANSACTION connection.
 * @param {string|null} customerId
 * @param {number} amount - What the sale had settled for.
 * @param {string} tenantId
 * @param {string} userEmail
 * @returns {Promise<boolean>} Whether anything was reversed.
 */
const reverseSaleTx = async (conn, customerId, amount, tenantId, userEmail, options = {}) => {
  if (!customerId) return false;

  // ── Visit vs value ───────────────────────────────────────────────────────
  // Returning one item from a four-item dinner did not un-happen the visit, so
  // only a FULL return takes it off; the spend comes off either way, by the
  // value actually returned.
  //
  // Defaults to removing the visit so the existing full-refund caller behaves
  // exactly as it did — a partial return is the new case and opts in.
  const removeVisit = options.removeVisit !== false;
  const query = removeVisit
    ? QUERIES.POS_CUSTOMER.REVERSE_SALE
    : QUERIES.POS_CUSTOMER.REVERSE_SALE_VALUE_ONLY;

  const [result] = await conn.execute(query, [
    Number(amount) || 0, userEmail, customerId, tenantId,
  ]);

  if (!result.affectedRows) {
    logger.warn('Return against an unknown customer — no CRM reversal', { customerId, tenantId });
    return false;
  }
  return true;
};

module.exports = { recordSaleTx, reverseSaleTx };
