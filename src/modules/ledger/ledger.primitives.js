// src/modules/ledger/ledger.primitives.js
// The three operations every ledger document needs, whichever kind it is.
//
// Extracted when returns arrived. Before that, `ledger.service.js` owned them
// and posted sales and expenses — one module, one caller, no tension. A credit
// note needs the same master lookup, the same rounding and the same guarded
// status move, and there were only two ways to give it them: have the returns
// service import the sales service (which would make the reversal depend on the
// thing it reverses, for no reason), or lift the shared three out here.
//
// So this is dependency inversion applied where it actually pays: both document
// services depend on these primitives, and neither depends on the other.
// Nothing here knows what a sale or a return is.

const { v4: uuidv4 } = require('uuid');
const { QUERIES } = require('../../config/constants');
const MESSAGES = require('../../config/messages');
const { HttpError } = require('../../middleware/errorHandler');
const { toMinor, fromMinor } = require('../../utils/taxCalculator');

/**
 * Looks a master up by name, failing loudly — a missing master is a seed bug,
 * not a runtime condition to work around.
 */
const requireMaster = async (conn, query, name, tenantId, label) => {
  const [rows] = await conn.execute(query, [name, tenantId]);
  if (!rows || rows.length === 0) {
    throw new HttpError(
      `${MESSAGES.ERROR.LEDGER_MASTER_MISSING}${label} '${name}'.`,
      MESSAGES.HTTP_STATUS.BAD_REQUEST,
    );
  }
  return rows[0];
};

/**
 * Rounds a payable to the nearest rupee and reports the adjustment.
 *
 * Cash tills cannot hand over paise, so the ledger records the rounding rather
 * than letting it vanish into a mismatched total.
 *
 * @param {number} gross
 * @returns {{roundedGross:number, roundOff:number}}
 */
const applyRoundOff = (gross) => {
  const grossMinor = toMinor(gross);
  const roundedMinor = Math.round(grossMinor / 100) * 100;
  return {
    roundedGross: fromMinor(roundedMinor),
    roundOff: fromMinor(roundedMinor - grossMinor),
  };
};

/**
 * Moves a document to a new status, but only if the whitelist permits it, and
 * records the move.
 *
 * This is the state machine doing its job: `transactiontypebaseconversion` is
 * the rule, `transactiontypeconversionmapper` is the event.
 */
const transitionStatus = async (
  conn, { logId, configId, fromStatusId, toStatusId, settledAt }, tenantId, userPhone,
) => {
  const [permitted] = await conn.execute(QUERIES.LEDGER.SELECT_TRANSITION, [
    configId, fromStatusId, toStatusId, tenantId,
  ]);
  if (!permitted || permitted.length === 0) {
    throw new HttpError(
      MESSAGES.ERROR.LEDGER_TRANSITION_NOT_ALLOWED,
      MESSAGES.HTTP_STATUS.CONFLICT,
    );
  }

  await conn.execute(QUERIES.LEDGER.INSERT_CONVERSION_MAPPER, [
    uuidv4(), tenantId, permitted[0].Id, logId, toStatusId, userPhone, userPhone,
  ]);
  await conn.execute(QUERIES.LEDGER.UPDATE_LOG_STATUS, [
    toStatusId, settledAt ?? null, userPhone, logId, tenantId,
  ]);
};

module.exports = { requireMaster, applyRoundOff, transitionStatus };
