// src/modules/posonlineorder/posonlineorder.kpt.js
// Kitchen Preparation Time — the number we promise a portal when we accept.
//
// ITS OWN MODULE, not another block inside lifecycle.js. Accepting an order
// already does five things (re-check the transition, price the lines, create a
// round, fire a KOT, push the status); deciding how long the kitchen needs is a
// sixth concern with its own rules and its own failure modes, and it is the one
// a merchant rating is scored on.
//
// KptMinutes is NOT PromisedOn. PromisedOn is the PORTAL's delivery SLA — their
// promise about the doorstep. This is ours about the pass. Conflating them is
// how a kitchen gets blamed for a rider running late.

const { QUERIES, KPT } = require('../../config/constants');
const { POS_SETTING_KEYS } = require('../../config/constants');
const { logger } = require('../../utils/logger');

/**
 * Chooses the KPT to commit to, in priority order.
 *
 *   1. What the person accepting typed. They can see the pass; nothing here
 *      knows more than they do.
 *   2. The slowest dish on the order — the kitchen is not finished until its
 *      last item is.
 *   3. The branch default.
 *   4. The platform default, so this can never resolve to nothing.
 *
 * A pure function on purpose: every branch of this is worth testing, and none
 * of it needs a database to be worth testing.
 *
 * @param {Object} input
 * @param {number|null|undefined} input.explicit    what the accepting user sent
 * @param {number|null|undefined} input.slowestLine MAX(PrepTimeMinutes) of the lines
 * @param {number|null|undefined} input.branchDefault from pos_setting
 * @returns {{minutes:number, source:string}}
 */
const resolveKpt = ({ explicit, slowestLine, branchDefault } = {}) => {
  const usable = (v) => v !== null && v !== undefined && Number.isFinite(Number(v)) && Number(v) > 0;

  if (usable(explicit)) return { minutes: clamp(Number(explicit)), source: 'explicit' };
  if (usable(slowestLine)) return { minutes: clamp(Number(slowestLine)), source: 'slowest-line' };
  if (usable(branchDefault)) return { minutes: clamp(Number(branchDefault)), source: 'branch-default' };
  return { minutes: KPT.DEFAULT_MINUTES, source: 'platform-default' };
};

/**
 * Keeps a promise inside the believable range.
 *
 * Zero would tell a portal the food is already made; 200 (a typo for 20) shows
 * the customer an absurd wait and counts against the outlet either way. Clamped
 * rather than rejected: an accept must not fail because of a mistyped number
 * when a sane one is obvious.
 */
const clamp = (n) => Math.min(KPT.MAX_MINUTES, Math.max(KPT.MIN_MINUTES, Math.round(n)));

/**
 * MAX(PrepTimeMinutes) across the menu rows an order's lines point at.
 *
 * Runs on the CALLER'S connection — accept is already inside a transaction, and
 * a helper that opens its own second connection while the caller holds one is
 * exactly the shape that deadlocks the pool.
 *
 * @param {Object} conn open connection
 * @param {string[]} itemMetaIds
 * @param {string} tenantId
 * @returns {Promise<number|null>}
 */
const getSlowestLineTx = async (conn, itemMetaIds, tenantId) => {
  const ids = [...new Set((itemMetaIds || []).filter(Boolean))];
  if (ids.length === 0) return null;

  const sql = QUERIES.POS_ONLINE_ORDER.SELECT_MAX_PREP_TIME.replace(
    ':ids',
    new Array(ids.length).fill('?').join(', '),
  );
  const [rows] = await conn.execute(sql, [tenantId, ...ids]);
  const max = rows?.[0]?.MaxPrep;
  return max === null || max === undefined ? null : Number(max);
};

/**
 * The branch's fallback KPT, if one is configured.
 *
 * @param {Object} conn open connection
 * @param {string} branchDetailId
 * @param {string} tenantId
 * @returns {Promise<number|null>}
 */
const getBranchDefaultTx = async (conn, branchDetailId, tenantId) => {
  if (!branchDetailId) return null;
  const [rows] = await conn.execute(
    QUERIES.POS_SETTING.SELECT_VALUE,
    [tenantId, branchDetailId, POS_SETTING_KEYS.KPT_DEFAULT_MINUTES],
  );
  const raw = rows?.[0]?.SettingValue;
  if (raw === null || raw === undefined || raw === '') return null;
  const n = Number(raw);
  // A setting somebody typed as "twenty" must not become NaN minutes.
  return Number.isFinite(n) ? n : null;
};

/**
 * Everything above, in one call, on the caller's connection.
 *
 * @param {Object} conn open connection
 * @param {Object} input
 * @param {number|null|undefined} input.explicit
 * @param {string[]} input.itemMetaIds
 * @param {string|null} input.branchDetailId
 * @param {string} input.tenantId
 * @returns {Promise<{minutes:number, source:string}>}
 */
const decideKptTx = async (conn, { explicit, itemMetaIds, branchDetailId, tenantId }) => {
  // Skip both reads when the user has already answered — the lookups exist to
  // suggest a number, and there is nothing to suggest once one is given.
  if (explicit !== null && explicit !== undefined) {
    return resolveKpt({ explicit });
  }

  const [slowestLine, branchDefault] = [
    await getSlowestLineTx(conn, itemMetaIds, tenantId),
    await getBranchDefaultTx(conn, branchDetailId, tenantId),
  ];

  const decision = resolveKpt({ slowestLine, branchDefault });
  logger.info('KPT resolved for a portal order', {
    tenantId, branchDetailId, slowestLine, branchDefault, ...decision,
  });
  return decision;
};

module.exports = {
  resolveKpt,
  clamp,
  getSlowestLineTx,
  getBranchDefaultTx,
  decideKptTx,
};
