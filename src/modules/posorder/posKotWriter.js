// src/modules/posorder/posKotWriter.js
// Writes one kitchen ticket for a round.
//
// Lives on its own so both the order service (which fires a KOT the moment a
// round is placed) and the transfer logic (which fires one for a round created
// by an item split) produce an identical ticket. Putting it in either of those
// would make them import each other.

const { v4: uuidv4 } = require('uuid');
const { QUERIES } = require('../../config/constants');
const { issuePosNumber } = require('./posNumbering');

// Serialize object/array values for JSON columns; pass through strings and null.
const toJson = (v) => (v == null ? null : typeof v === 'string' ? v : JSON.stringify(v));

/**
 * Writes a KOT for an order on an already-open transaction.
 *
 * The order's Items are snapshotted as-is: the ticket records what the kitchen
 * was told to cook, which is not the same thing as what the round says today.
 *
 * @param {Object} conn - Open transaction connection.
 * @param {Object} order - { Id, TableId, Items, BranchDetailId }
 * @param {string} tenantId
 * @param {string} userEmail
 * @param {string} [kotNo] - Explicit number; otherwise issued from the series.
 * @returns {Promise<Object>} { KotId, KotNo, OrderId, Status }
 */
const writeKot = async (conn, order, tenantId, userEmail, kotNo) => {
  const kotId = uuidv4();
  const number = kotNo
    || (await issuePosNumber(conn, 'POS_KOT', 'KOT', tenantId, userEmail));
  await conn.execute(QUERIES.POS_KOT.INSERT, [
    kotId,
    tenantId,
    number,
    order.Id,
    order.TableId ?? null,
    toJson(order.Items),
    'pending',
    new Date(),
    order.BranchDetailId ?? null,
    1,
    userEmail,
    userEmail,
  ]);
  return { KotId: kotId, KotNo: number, OrderId: order.Id, Status: 'pending' };
};

/**
 * The round's live kitchen ticket, if it has one.
 *
 * "Live" excludes cancelled: that ticket was pulled from the pass, so sending
 * the round again is a legitimate act rather than a duplicate. Used to make
 * sending send-once — pressing the button twice must not put the same food on
 * the pass twice.
 *
 * @param {Object} conn - Open transaction connection.
 * @param {string} orderId
 * @param {string} tenantId
 * @returns {Promise<Object|null>} { Id, KotNo, Status } or null.
 */
const findLiveKotTx = async (conn, orderId, tenantId) => {
  const [rows] = await conn.execute(
    `SELECT Id, KotNo, Status FROM pos_kot
      WHERE OrderId = ? AND TenantId = ? AND Active = 1
        AND LOWER(COALESCE(Status, 'pending')) <> 'cancelled'
      ORDER BY CreatedOn ASC LIMIT 1`,
    [orderId, tenantId],
  );
  return rows && rows.length > 0 ? rows[0] : null;
};

module.exports = { writeKot, findLiveKotTx };
