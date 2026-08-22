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

const { QUERIES, LOYALTY } = require('../../config/constants');
const { logger } = require('../../utils/logger');

/**
 * Records a settled sale against a customer.
 *
 * Increments rather than recomputing: the live path runs inside the settle
 * transaction and must stay cheap, and an increment cannot scan. A rebuild from
 * the ledger is available separately (see database/upgrades) for the rare case
 * where the two need reconciling.
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
  // Whole points only, and never negative: a refund must not mint loyalty.
  const points = spend > 0 ? Math.floor(spend / LOYALTY.RUPEES_PER_POINT) : 0;

  const [result] = await conn.execute(QUERIES.POS_CUSTOMER.RECORD_SALE, [
    spend, points, userEmail, customerId, tenantId,
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

module.exports = { recordSaleTx };
