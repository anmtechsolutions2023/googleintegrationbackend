// src/modules/pospaymentmethod/pospaymentmethod.repository.js
//
// SQL, and nothing else. No rules about what an answer MEANS — the service owns
// the resolve rule and the guards; this file owns only how rows are fetched and
// written, so either can be reasoned about without the other in your head.
//
// Every function takes a connection rather than opening one. The save is several
// statements that must stand or fall together, so the transaction has to be owned
// one level up; a repository that opened its own connection could not take part.

const { v4: uuidv4 } = require('uuid');
const { QUERIES } = require('../../config/constants');

/**
 * Every method in the tenant's catalogue, with this branch's override folded in.
 *
 * ONE query, not two passes. The LEFT JOIN is what makes "no row means inherit"
 * (see the table comment) a property of the read rather than something every
 * caller has to remember to apply — BranchEnabled comes back NULL exactly when
 * the branch has not decided, and NULL is the signal the service reads.
 *
 * @param {Object} conn
 * @param {string} branchId
 * @param {string} tenantId
 * @returns {Promise<Array>} Raw rows.
 */
const listForBranch = async (conn, branchId, tenantId) => {
  const [rows] = await conn.execute(
    QUERIES.POS_BRANCH_PAYMENT_METHOD.SELECT_RESOLVED, [branchId, tenantId],
  );
  return rows || [];
};

/**
 * The catalogue rows for a set of ids, so a save can check what it was given.
 *
 * Bound one placeholder per id — never interpolated. An empty list short-circuits
 * rather than emitting `IN ()`, which is a syntax error in MySQL.
 *
 * @param {Object} conn
 * @param {string[]} ids
 * @param {string} tenantId
 * @returns {Promise<Array>}
 */
const findModesByIds = async (conn, ids, tenantId) => {
  if (!ids.length) return [];
  const placeholders = ids.map(() => '?').join(', ');
  const [rows] = await conn.execute(
    QUERIES.POS_BRANCH_PAYMENT_METHOD.SELECT_MODES_BY_IDS.replace(':ids', placeholders),
    [tenantId, ...ids],
  );
  return rows || [];
};

/**
 * Record a branch's deviation from the tenant default.
 *
 * Upsert on the unique key, so pressing a toggle twice leaves one row rather than
 * a second opinion.
 */
const upsertOverride = async (conn, { branchId, paymentModeId, enabled }, tenantId, userPhone) => {
  await conn.execute(QUERIES.POS_BRANCH_PAYMENT_METHOD.UPSERT, [
    uuidv4(), tenantId, branchId, paymentModeId, enabled ? 1 : 0, userPhone, userPhone,
  ]);
};

/**
 * Drop a branch's override, returning it to the tenant default.
 *
 * Called when a save sets a method back to its default value. Storing "the same
 * as the default" as a row would work, but it would also freeze that branch
 * against a later change of the default — which is the one thing the inherit
 * rule is for.
 */
const deleteOverride = async (conn, { branchId, paymentModeId }, tenantId) => {
  await conn.execute(
    QUERIES.POS_BRANCH_PAYMENT_METHOD.DELETE_ONE, [tenantId, branchId, paymentModeId],
  );
};

module.exports = { listForBranch, findModesByIds, upsertOverride, deleteOverride };
