// src/modules/ledger/ledger.source.js
// How a ledger document is identified to a human: by token, by table, or by
// neither. One rule for every read — the ledger list and detail, Dues, and the
// write-off register — so no screen invents its own idea of what an order "is".
//
// Pure: no database, no services. Kept apart so a report can use it without
// pulling in the write paths the read service depends on.

/**
 * @returns {{kind:'token'|'table'|'none', label:string|null, orderNos:string[]}}
 */
const sourceOf = (tokenLabel, tableName, orderNos = []) => {
  // Token wins: a counter customer is holding a number, not a table. A round
  // can legitimately have both if it was moved, and the number is what was
  // actually handed over.
  if (tokenLabel) return { kind: 'token', label: tokenLabel, orderNos };
  if (tableName) return { kind: 'table', label: tableName, orderNos };
  return { kind: 'none', label: null, orderNos };
};

/** From the joined rounds of one document (the detail read). */
const describeSource = (orders = []) => {
  const join = (key) => [...new Set(orders.map((o) => o[key]).filter(Boolean))].join(', ') || null;
  return sourceOf(join('TokenLabel'), join('TableName'), orders.map((o) => o.OrderNo).filter(Boolean));
};

/** From the pre-concatenated columns DOC_SOURCE_COLUMNS_SQL returns. Same rule. */
const splitList = (v) => (v ? String(v).split(', ').filter(Boolean) : []);
const describeSourceRow = (row) =>
  sourceOf(row.TokenLabels || null, row.TableNames || null, splitList(row.OrderNos));

module.exports = { sourceOf, describeSource, describeSourceRow };
