// src/modules/ledger/transactionNumber.service.js
// Gap-free document numbering.
//
// A ledger must not issue the same number twice, and must not leave holes it
// cannot explain. `transactiontypeconfig` owns the sequence:
//   StartCounterNo    where the sequence begins
//   CurrentCounterNo  where it has got to
//   Prefix + Format   how it renders  (INV-{0000} → INV-0042)
//
// Safety is layered: the config row is taken with SELECT ... FOR UPDATE so two
// tills serialise on it, and UNIQUE(TransactionNo, TenantId) on the log is the
// backstop if that ever fails.

const { QUERIES } = require('../../config/constants');
const { HttpError } = require('../../middleware/errorHandler');
const MESSAGES = require('../../config/messages');

/**
 * Renders a counter using the config's Prefix/Format.
 *
 * `Format` may contain a `{0000}` placeholder giving the zero-padding width.
 * Anything else falls back to `Prefix + counter`, so a misconfigured format
 * degrades to a usable number rather than failing a sale.
 *
 * @param {Object} config - { Prefix, Format }
 * @param {number} counter
 * @returns {string}
 */
const formatNumber = (config, counter) => {
  const prefix = config.Prefix || '';
  const format = config.Format || '';
  const match = /\{(0+)\}/.exec(format);

  if (match) {
    const padded = String(counter).padStart(match[1].length, '0');
    return format.replace(match[0], padded);
  }
  // No placeholder: treat Format as a literal prefix when present.
  return `${format || prefix}${counter}`;
};

/**
 * Issues the next document number for a numbering config.
 *
 * MUST be called with an open transaction connection — the row lock is only
 * meaningful inside one, and a rolled-back sale must return its number.
 *
 * @param {Object} conn - Open transaction connection.
 * @param {string} transactionTypeConfigId
 * @param {string} tenantId
 * @param {string} userEmail
 * @returns {Promise<{transactionNo:string, counter:number}>}
 */
const issueNumber = async (conn, transactionTypeConfigId, tenantId, userEmail) => {
  const [rows] = await conn.execute(QUERIES.LEDGER.SELECT_CONFIG_FOR_UPDATE, [
    transactionTypeConfigId,
    tenantId,
  ]);
  if (!rows || rows.length === 0) {
    throw new HttpError(
      MESSAGES.ERROR.LEDGER_CONFIG_MISSING,
      MESSAGES.HTTP_STATUS.BAD_REQUEST,
    );
  }

  const config = rows[0];
  const start = Number(config.StartCounterNo) || 1;
  const current = Number(config.CurrentCounterNo) || 0;
  // First issue starts AT StartCounterNo; later ones continue from where the
  // sequence got to.
  const next = current > 0 ? current + 1 : start;

  await conn.execute(QUERIES.LEDGER.UPDATE_COUNTER, [
    next,
    userEmail,
    transactionTypeConfigId,
    tenantId,
  ]);

  return { transactionNo: formatNumber(config, next), counter: next };
};

/**
 * Issues the next number for a series addressed by its TagName.
 *
 * Financial documents know their config id already. Operational documents
 * (orders, KOTs, bills) only know which series they belong to, so they look it
 * up by tag. Returns `null` when the tenant has no such series — the caller
 * decides whether that is fatal. It must not be for a sale: a missing master row
 * is a provisioning gap, and wedging the till over it would be worse than the
 * gap itself.
 *
 * MUST be called with an open transaction connection — see issueNumber.
 *
 * @param {Object} conn - Open transaction connection.
 * @param {string} tagName - e.g. 'POS_ORDER', 'POS_KOT', 'POS_BILL'.
 * @param {string} tenantId
 * @param {string} userEmail
 * @returns {Promise<string|null>} The rendered number, or null if unconfigured.
 */
const issueByTag = async (conn, tagName, tenantId, userEmail) => {
  const [rows] = await conn.execute(QUERIES.LEDGER.SELECT_CONFIG_BY_TAG, [
    tagName,
    tenantId,
  ]);
  // Anything other than a row with an Id means "no series here" — treated the
  // same as a miss. This runs on the sale path, so an unexpected result shape
  // must degrade to the caller's fallback rather than throw.
  if (!Array.isArray(rows) || rows.length === 0 || !rows[0]?.Id) return null;
  const { transactionNo } = await issueNumber(conn, rows[0].Id, tenantId, userEmail);
  return transactionNo;
};

module.exports = { issueNumber, issueByTag, formatNumber };
