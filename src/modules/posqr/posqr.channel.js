// src/modules/posqr/posqr.channel.js
// The sales channels QR ordering reads and writes against.
//
// The QR channel is provisioned with the other POS masters for a new tenant,
// but a tenancy set up before QR ordering existed has none. Rather than make
// "run a backfill" a prerequisite for switching the feature on, the channel is
// ensured on first use — the insert is idempotent on UNIQUE (Code, TenantId),
// so two first diners at once converge on one row.

const { v4: uuidv4 } = require('uuid');
const { withConnection } = require('../../utils/dbHelper');
const { QUERIES, QR_ORDERING } = require('../../config/constants');

const Q = QUERIES.POS_DINE;
const { CHANNEL, FALLBACK_CHANNEL_CODE } = QR_ORDERING;

const findIdTx = async (conn, code, tenantId) => {
  const [rows] = await conn.execute(Q.CHANNEL_BY_CODE, [tenantId, code]);
  return rows[0] ? rows[0].Id : null;
};

/**
 * The tenant's QR channel id, creating the channel if it is missing.
 * @param {Object} conn
 * @param {string} tenantId
 * @returns {Promise<string>}
 */
const ensureQrChannelTx = async (conn, tenantId) => {
  const existing = await findIdTx(conn, CHANNEL.CODE, tenantId);
  if (existing) return existing;
  await conn.execute(Q.INSERT_CHANNEL, [
    uuidv4(), CHANNEL.NAME, CHANNEL.CODE, CHANNEL.DESCRIPTION, CHANNEL.SORT_ORDER,
    tenantId, 'system', 'system',
  ]);
  return findIdTx(conn, CHANNEL.CODE, tenantId);
};

const ensureQrChannel = (tenantId) =>
  withConnection((conn) => ensureQrChannelTx(conn, tenantId));

/** The dine-in channel id, or null — the menu fallback before QR links exist. */
const findFallbackChannelIdTx = (conn, tenantId) =>
  findIdTx(conn, FALLBACK_CHANNEL_CODE, tenantId);

module.exports = { ensureQrChannelTx, ensureQrChannel, findFallbackChannelIdTx };
