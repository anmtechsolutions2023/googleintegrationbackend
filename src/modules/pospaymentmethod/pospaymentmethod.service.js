// src/modules/pospaymentmethod/pospaymentmethod.service.js
//
// Which tenders THIS outlet accepts.
//
// WHAT THIS OWNS
// The resolve rule and the guards around changing it. It does not own what a
// payment method IS — the name, the ledger account it books to, whether it needs
// a reference number — that is the tenant-wide catalogue (modules/paymentmode).
// The seam matters: a method exists once for the business and is offered, or not,
// once per outlet, and conflating the two is how "delete Card" turns into "delete
// Card at this one till".
//
// THE RESOLVE RULE, IN ONE PLACE
// No override row means inherit paymentmode.EnabledByDefault. Every read goes
// through `resolveRow` below and every write goes through `save`, so the rule is
// stated once. The alternative — each caller doing its own COALESCE — is how a
// report and a till come to disagree about what an outlet accepts.

const { withConnection, withTransaction } = require('../../utils/dbHelper');
const { HttpError } = require('../../middleware/errorHandler');
const MESSAGES = require('../../config/messages');
const { logger } = require('../../utils/logger');
const repository = require('./pospaymentmethod.repository');

/**
 * One catalogue row plus this branch's override, as the API shape.
 *
 * `source` is not decoration: it is how the UI knows whether to offer a Reset,
 * and how a support question ("why is Card off here?") gets an answer without
 * reading the table.
 *
 * @param {Object} row - A SELECT_RESOLVED row.
 * @returns {Object}
 */
const resolveRow = (row) => {
  const inherited = row.BranchEnabled === null || row.BranchEnabled === undefined;
  const enabledByDefault = !!row.EnabledByDefault;

  return {
    paymentModeId: row.Id,
    type: row.Type,
    accountId: row.AccountId ?? null,
    accountName: row.AccountName ?? null,
    accountKind: row.AccountKind ?? null,
    requiresReference: !!row.RequiresReference,
    active: !!row.Active,
    enabled: inherited ? enabledByDefault : !!row.BranchEnabled,
    enabledByDefault,
    source: inherited ? 'default' : 'branch',
  };
};

/**
 * Every method in the catalogue with its effective state at one branch.
 *
 * Returns the WHOLE catalogue, including what this outlet does not accept — the
 * config screen needs the off rows to offer them, and the till filters. Serving
 * only the enabled ones would mean two endpoints for one list.
 *
 * @param {string} branchId
 * @param {string} tenantId
 * @param {Object} [conn] - Join a caller's transaction.
 * @returns {Promise<{branchId: string, methods: Array}>}
 */
const listForBranch = async (branchId, tenantId, conn) => withConnection(
  async (connection) => {
    const rows = await repository.listForBranch(connection, branchId, tenantId);
    return { branchId, methods: rows.map(resolveRow) };
  },
  conn,
);

/**
 * What the branch would accept once `changes` are applied.
 *
 * Computed from the CURRENT resolved state rather than from the request alone,
 * because a save is allowed to be partial: a screen toggling one switch sends one
 * entry, and whether that leaves the outlet able to take money depends entirely
 * on the rows it did not mention.
 *
 * @param {Array} current - Resolved methods.
 * @param {Map<string, boolean>} changes - paymentModeId → enabled.
 * @returns {Array} The methods that would be offered at the counter.
 */
const enabledAfter = (current, changes) => current.filter((m) => {
  const next = changes.has(m.paymentModeId) ? changes.get(m.paymentModeId) : m.enabled;
  // An inactive method is not offered whatever the branch says about it, so it
  // cannot be what keeps a till alive.
  return next && m.active;
});

/**
 * Apply a branch's payment-method decisions, atomically.
 *
 * PARTIAL LISTS ARE LEGAL. A method not named is left exactly as it was, so the
 * screen can save one toggle without restating the rest — and two people editing
 * different switches do not overwrite each other.
 *
 * SETTING A METHOD BACK TO ITS DEFAULT DELETES THE ROW. Storing "same as the
 * default" would work today and freeze that branch against any later change of
 * the default, which is the one thing inheritance is for.
 *
 * @param {string} branchId
 * @param {string} tenantId
 * @param {Array<{paymentModeId: string, enabled: boolean}>} methods
 * @param {string} userPhone
 * @returns {Promise<{branchId: string, methods: Array}>} The state after saving.
 * @throws {HttpError} 400 for an unknown id, 409 for a save that leaves nothing.
 */
const save = async (branchId, tenantId, methods, userPhone) => withTransaction(
  async (conn) => {
    const ids = methods.map((m) => m.paymentModeId);

    // Every id must be a method this TENANT owns. Without this the endpoint
    // would happily write an override for another tenant's method id — the row
    // would be invisible to both, but it is still a write we were not asked for.
    const known = await repository.findModesByIds(conn, ids, tenantId);
    const knownById = new Map(known.map((m) => [m.Id, m]));
    const unknown = ids.filter((id) => !knownById.has(id));
    if (unknown.length) {
      throw new HttpError(
        `No payment method exists for id ${unknown[0]}.`,
        MESSAGES.HTTP_STATUS.BAD_REQUEST,
      );
    }

    const { methods: current } = await listForBranch(branchId, tenantId, conn);
    const changes = new Map(methods.map((m) => [m.paymentModeId, !!m.enabled]));

    // THE GUARD. A till that can take no money is not a state worth persisting,
    // and the error is far cheaper here than at a counter mid-sale.
    if (!enabledAfter(current, changes).length) {
      throw new HttpError(
        'An outlet must accept at least one payment method. '
        + 'Switch another one on before turning this one off.',
        MESSAGES.HTTP_STATUS.CONFLICT,
      );
    }

    for (const { paymentModeId, enabled } of methods) {
      const wanted = !!enabled;
      if (wanted === !!knownById.get(paymentModeId).EnabledByDefault) {
        await repository.deleteOverride(conn, { branchId, paymentModeId }, tenantId);
      } else {
        await repository.upsertOverride(
          conn, { branchId, paymentModeId, enabled: wanted }, tenantId, userPhone,
        );
      }
    }

    logger.info('Branch payment methods updated', {
      tenantId, branchId, count: methods.length, by: userPhone,
    });

    // Re-read rather than patching the in-memory copy: the response is then the
    // stored truth, which is what the screen re-renders from.
    return listForBranch(branchId, tenantId, conn);
  },
);

module.exports = { listForBranch, save, resolveRow, enabledAfter };
