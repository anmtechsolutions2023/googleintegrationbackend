// src/modules/postoken/postoken.report.service.js
// How the counter QUEUE performed — not what it earned.
//
// Kept out of ledger.report.service on purpose. That engine's one invariant is
// that every figure comes from the ledger, because a number read from
// operational tables can disagree with the invoice that was issued. A token is
// operational state: it records how long somebody stood at a counter, which is
// a real question but not an accounting one. Revenue by channel answers the
// money half and lives there; this answers the service half and lives here.
//
// Both use the same date resolver, so a range means the same thing on both
// sides of the Finance screen.

const { withConnection } = require('../../utils/dbHelper');
const { QUERIES } = require('../../config/constants');
const { resolveRange } = require('../../utils/dateRange');

const num = (v) => Number(v || 0);

/** Seconds → whole minutes, for figures a human reads rather than sums. */
const toMinutes = (seconds) =>
  (seconds == null ? null : Math.round((Number(seconds) / 60) * 10) / 10);

/**
 * Counter queue statistics for a date range.
 *
 * Wait is measured issue → called (how long the customer stood there) and
 * called → served separately (how long they took to walk up once called).
 * Merging them would blame the kitchen for a customer who wandered off.
 *
 * Tokens still waiting contribute to Issued but not to any average: a wait that
 * has not ended yet is not a short wait, and counting it as zero would flatter
 * every number on the screen.
 *
 * @param {Object} query - { preset, fromDate, toDate, branchId }
 * @param {string} tenantId
 * @returns {Promise<Object>} { range, summary, trend }
 */
const queueStats = (query, tenantId) =>
  withConnection(async (conn) => {
    const range = resolveRange(query);
    // TokenDate is a DATE column, so the range's date bounds apply directly —
    // no datetime conversion, and no timezone question to get wrong.
    const params = [tenantId, range.from, range.to];
    const branchClause = query.branchId ? ' AND BranchDetailId = ?' : '';
    const branchParam = query.branchId ? [query.branchId] : [];

    const [[summary]] = await conn.execute(
      QUERIES.POS_TOKEN_STATS.SUMMARY + branchClause,
      [...params, ...branchParam],
    );
    const [trend] = await conn.execute(
      `${QUERIES.POS_TOKEN_STATS.BY_DAY + branchClause} GROUP BY TokenDate ORDER BY TokenDate ASC`,
      [...params, ...branchParam],
    );

    const s = summary || {};
    return {
      range,
      summary: {
        Issued: num(s.Issued),
        Served: num(s.Served),
        Waiting: num(s.Waiting),
        Called: num(s.Called),
        Cancelled: num(s.Cancelled),
        AvgWaitMinutes: toMinutes(s.AvgWaitSeconds),
        MaxWaitMinutes: toMinutes(s.MaxWaitSeconds),
        AvgCollectMinutes: toMinutes(s.AvgCollectSeconds),
      },
      trend: trend.map((r) => ({
        Bucket: r.Bucket,
        Issued: num(r.Issued),
        Served: num(r.Served),
        AvgWaitMinutes: toMinutes(r.AvgWaitSeconds),
      })),
    };
  });

module.exports = { queueStats };
