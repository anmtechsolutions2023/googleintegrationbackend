// src/modules/posorder/posorder.detail.service.js
// One round, and everything that hangs off it.
//
// Assembled on the server so that every screen linking an order number — the
// ledger, the dashboard, the token queue — opens the SAME view of it. The
// alternative is each screen joining what it happens to have in hand, which is
// how the dashboard ended up able to name a table but not a token.
//
// Read-only: this composes existing reads and writes nothing.

const { withConnection } = require('../../utils/dbHelper');
const { QUERIES } = require('../../config/constants');
const { HttpError } = require('../../middleware/errorHandler');

const asArray = (v) => {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') {
    try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch { return []; }
  }
  return [];
};

/**
 * How this round is identified to a human.
 *
 * Mirrors the ledger's rule deliberately (ledger.read.service.sourceOf): token
 * first, because a counter customer is holding a number rather than a table.
 * If the two disagreed, the same sale would be labelled differently depending
 * on which screen you opened it from.
 *
 * @returns {{kind:'token'|'table'|'none', label:string|null}}
 */
const sourceOf = (row) => {
  if (row.TokenLabel) return { kind: 'token', label: row.TokenLabel };
  if (row.TableName) return { kind: 'table', label: row.TableName };
  return { kind: 'none', label: null };
};

/**
 * Full detail for one round.
 *
 * @param {string} id - Order id.
 * @param {string} tenantId
 * @returns {Promise<Object>} order + token + kots + bill/invoice linkage.
 */
const getOrderDetail = (id, tenantId) =>
  withConnection(async (conn) => {
    const [rows] = await conn.execute(QUERIES.POS_ORDER_DETAIL.ORDER, [id, tenantId]);
    if (rows.length === 0) throw new HttpError('POS Order not found', 404);
    const row = rows[0];

    const [kots] = await conn.execute(QUERIES.POS_ORDER_DETAIL.KOTS, [id, tenantId]);
    const [bills] = await conn.execute(QUERIES.POS_ORDER_DETAIL.BILL, [id, tenantId]);

    return {
      Order: {
        Id: row.Id,
        OrderNo: row.OrderNo,
        OrderType: row.OrderType,
        Status: row.Status,
        Items: asArray(row.Items),
        SubTotal: Number(row.SubTotal) || 0,
        TaxAmount: Number(row.TaxAmount) || 0,
        Total: Number(row.Total) || 0,
        CreatedOn: row.CreatedOn,
        CreatedBy: row.CreatedBy,
        BranchDetailId: row.BranchDetailId,
        // The venue SNAPSHOT frozen on the round, not a live join — the same
        // reason the reports read it: a renamed table must not rewrite history.
        TableId: row.TableId,
        TableName: row.TableName,
        FloorName: row.FloorName,
        TableCapacity: row.TableCapacity,
      },
      // Null rather than an empty object: "this round had no token" is a fact
      // the UI renders, not a missing field.
      Token: row.TokenId ? {
        Id: row.TokenId,
        TokenLabel: row.TokenLabel,
        TokenNumber: row.TokenNumber,
        Status: row.TokenStatus,
        TokenDate: row.TokenDate,
        CalledAt: row.CalledAt,
        ServedAt: row.ServedAt,
      } : null,
      Kots: kots,
      Bill: bills[0] || null,
      Source: sourceOf(row),
    };
  });

module.exports = { getOrderDetail, sourceOf };
