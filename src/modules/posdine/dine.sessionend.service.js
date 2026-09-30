// src/modules/posdine/dine.sessionend.service.js
//
// Paying the bill ends the meal.
//
// A diner session is a signed token with a three-hour life and no server-side
// record, which is what keeps the public diner routes cheap. That is right until
// the guest pays: nothing about settling reached the token, so for the rest of
// those three hours a guest who had paid and walked out could still place rounds
// on a table staff considered finished, and their phone still called the meal
// live.
//
// The fix is one timestamp per table. Settling stamps it; authenticateDiner
// refuses any token issued before the stamp. No session store, no revocation
// list, one column.
//
// WHY A TIMESTAMP AND NOT A FLAG. The next party sits at the same table ten
// minutes later and scans the same printed card. A flag would have to be cleared
// by something, and whatever forgot to clear it would lock a live table out of
// QR ordering for the rest of the evening. A moment in time needs no reset: a
// session opened after it is simply newer.

const { withTransaction } = require('../../utils/dbHelper');
const { QUERIES } = require('../../config/constants');
const { logger } = require('../../utils/logger');

const Q = QUERIES.POS_DINER_SESSION;

const bind = (sql, n) => sql.replace(':ids', new Array(n).fill('?').join(', '));

/**
 * Ends every diner session at the tables these rounds sat at.
 *
 * Takes a connection: this belongs to the settle transaction. A session ended
 * against a sale that then rolled back would throw a guest off a table that is
 * still theirs, mid-meal.
 *
 * Never throws. A bill that is paid is paid — failing the settle because a
 * session could not be ended would be a far worse outcome than a session that
 * outlives its meal, which is the behaviour this replaces.
 *
 * @param {Object} conn - The settle transaction's connection.
 * @param {string[]} orderIds - The rounds this bill covers.
 * @param {string} tenantId
 * @param {string} userPhone
 * @returns {Promise<number>} How many tables were stamped.
 */
const endForOrders = async (conn, orderIds, tenantId, userPhone) => {
  try {
    const ids = (orderIds || []).filter(Boolean);
    if (ids.length === 0) return 0;

    const [rows] = await conn.execute(
      bind(Q.TABLES_FOR_ORDERS, ids.length), [tenantId, ...ids],
    );
    // A counter sale has no table, and nothing to end.
    const tableIds = (rows || []).map((r) => r.TableId).filter(Boolean);
    if (tableIds.length === 0) return 0;

    await conn.execute(
      bind(Q.END_SESSIONS, tableIds.length), [userPhone, tenantId, ...tableIds],
    );
    logger.info('Diner sessions ended by settle', { tenantId, tables: tableIds.length });
    return tableIds.length;
  } catch (err) {
    logger.error('Could not end diner sessions on settle', { tenantId, err: err.message });
    return 0;
  }
};

/**
 * Was this session opened before its table was last settled?
 *
 * @param {Object} conn
 * @param {string} tableId
 * @param {string} tenantId
 * @param {Date} sessionStartedAt - The token's `iat`.
 * @returns {Promise<boolean>}
 */
const isEnded = async (conn, tableId, tenantId, sessionStartedAt) => {
  const [rows] = await conn.execute(Q.ENDED_AT, [tableId, tenantId]);
  const endedOn = rows?.[0]?.DinerSessionsEndedOn;
  if (!endedOn) return false;

  // `iat` has one-second resolution, so a session opened in the same second as
  // the settle compares equal. Treated as ended: of the two, refusing a session
  // that began the instant the bill was paid is the safer mistake.
  return new Date(endedOn).getTime() >= new Date(sessionStartedAt).getTime();
};

module.exports = { endForOrders, isEnded };
