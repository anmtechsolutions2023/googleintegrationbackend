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

module.exports = { issueNumber, formatNumber };
