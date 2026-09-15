// src/modules/taxsetting/taxsetting.service.js
// The GST switch: read it, and move it.
//
// WHAT THE SWITCH DOES
// When off, pricing passes no tax components, and computeTax's existing "exempt"
// path charges the menu price as it stands — inclusive or exclusive. No price is
// edited, no tax group is touched, and switching back restores today's
// behaviour on the next order.
//
// THE GUARD
// A change is refused while any round is open. Those rounds were priced under
// the old state; settling them under the new one would produce a bill that is
// part tax invoice, part bill of supply. Refusing is simpler and more honest
// than inventing a rule for which rounds get which treatment.

const { v4: uuidv4 } = require('uuid');
const { withConnection, withTransaction } = require('../../utils/dbHelper');
const { QUERIES } = require('../../config/constants');
const { HttpError } = require('../../middleware/errorHandler');
const MESSAGES = require('../../config/messages');
const { logger } = require('../../utils/logger');
const { normaliseGstin } = require('../../utils/gstStates');
const repository = require('./taxsetting.repository');

/** The two kinds of "off". Mirrors receipt.catalogue TAX_MODE minus 'gst'. */
const OFF_REASONS = Object.freeze(['composition', 'unregistered']);

/**
 * The tax mode a document issued right now would carry.
 * @param {{gstCharging:boolean, offReason:(string|null)}} setting
 * @returns {'gst'|'composition'|'unregistered'}
 */
const taxModeOf = (setting) => {
  if (!setting || setting.gstCharging) return 'gst';
  return OFF_REASONS.includes(setting.offReason) ? setting.offReason : 'unregistered';
};

/**
 * Setting, recent history and whatever would block a change — everything the
 * settings card needs in one read.
 */
const getStatus = (tenantId) => withConnection(async (conn) => {
  const [setting, history, openOrders, branches] = await Promise.all([
    repository.getTx(conn, tenantId),
    repository.historyTx(conn, tenantId),
    repository.openOrdersTx(conn, tenantId),
    repository.branchesTx(conn, tenantId),
  ]);
  return { ...setting, taxMode: taxModeOf(setting), history, openOrders, branches };
});

const describeOrder = (o) => {
  const where = o.tableName ? `table ${o.tableName}` : (o.orderType || 'counter');
  return `${o.orderNo} (${where})`;
};

/**
 * Moves the switch.
 *
 * @param {{gstCharging:boolean, offReason?:string}} input - validated
 * @param {string} tenantId
 * @param {string} userPhone
 * @returns {Promise<Object>} The resulting status.
 * @throws {HttpError} 409 while orders are open.
 */
const setStatus = async (input, tenantId, userPhone) => {
  const nextCharging = !!input.gstCharging;
  const nextReason = nextCharging ? null : input.offReason;

  await withTransaction(async (conn) => {
    const [locked] = await conn.execute(QUERIES.TAX_SETTING.SELECT_FOR_UPDATE, [tenantId]);
    const current = locked[0]
      ? { gstCharging: Number(locked[0].GstCharging) === 1, offReason: locked[0].OffReason || null }
      : { gstCharging: true, offReason: null };

    const chargingChanges = current.gstCharging !== nextCharging;
    const reasonChanges = !nextCharging && current.offReason !== nextReason;
    if (!chargingChanges && !reasonChanges) return;

    // Only moving the switch itself re-prices anything. Changing composition
    // to unregistered while already off changes the paper's footer, not a
    // single amount, so it is not held up by open tables.
    if (chargingChanges) {
      const open = await repository.openOrdersTx(conn, tenantId);
      if (open.length > 0) {
        const named = open.slice(0, 5).map(describeOrder).join(', ');
        const more = open.length > 5 ? ` and ${open.length - 5} more` : '';
        throw new HttpError(
          `Settle open orders before switching GST: ${named}${more}.`,
          MESSAGES.HTTP_STATUS.CONFLICT,
          'TAX_SWITCH_BLOCKED',
        );
      }
    }

    await conn.execute(QUERIES.TAX_SETTING.UPSERT, [
      tenantId, nextCharging ? 1 : 0, nextReason, userPhone, userPhone,
    ]);
    await conn.execute(QUERIES.TAX_SETTING.INSERT_HISTORY, [
      uuidv4(), tenantId, current.gstCharging ? 1 : 0, nextCharging ? 1 : 0, nextReason, userPhone,
    ]);

    logger.warn('GST charging changed', {
      tenantId, from: current.gstCharging, to: nextCharging, offReason: nextReason, userPhone,
    });
  });

  return getStatus(tenantId);
};

/**
 * Sets, changes or clears one branch's GSTIN.
 *
 * Not held up by open orders, unlike the switch: nothing is re-priced. Each
 * invoice takes the GSTIN the branch holds at the moment it is SETTLED, so a
 * bill settled after this carries the new one and every earlier document keeps
 * the one it was issued with.
 *
 * @param {string} branchId
 * @param {string|null} gstin - validated; blank or null clears it
 * @returns {Promise<Object>} The resulting status, branches included.
 * @throws {HttpError} 404 when the branch is not this tenant's.
 */
const setBranchGstin = async (branchId, gstin, tenantId, userPhone) => {
  const value = normaliseGstin(gstin) || null;
  const [result] = await withConnection((conn) => conn.execute(
    QUERIES.TAX_SETTING.UPDATE_BRANCH_GSTIN, [value, userPhone, branchId, tenantId],
  ));
  if (!result || result.affectedRows === 0) {
    throw new HttpError('Branch not found.', MESSAGES.HTTP_STATUS.NOT_FOUND);
  }
  logger.warn('Branch GSTIN changed', { tenantId, branchId, gstin: value, userPhone });
  return getStatus(tenantId);
};

module.exports = { OFF_REASONS, taxModeOf, getStatus, setStatus, setBranchGstin };
