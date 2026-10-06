// src/modules/ledger/ledger.venue.js
// The floor / table bound every document-level report shares. Kept apart from
// the report service so a report in its own module (write-offs) applies exactly
// the same rule rather than a copy of it.

/**
 * Restricts a document-level report to a floor or a table.
 *
 * EXISTS rather than a join: the point is to FILTER documents, and joining
 * through pos_bill_order would fan a multi-round bill out into several rows and
 * silently multiply every SUM in the report. EXISTS answers "did any of this
 * bill's rounds happen there?" without changing the row count at all.
 *
 * Reads the venue snapshot on the round, so the filter means "served on that
 * floor at the time", which is the only reading that stays true after the floor
 * plan is rearranged.
 *
 * @param {Object} query - { floorId, tableId }
 * @param {string} [logAlias] - Alias of transactiondetaillog in the outer query.
 * @returns {{clause:string, params:Array}}
 */
const venueFilter = (query, logAlias = 'l') => {
  const conditions = [];
  const params = [];
  if (query.floorId) { conditions.push('o.FloorId = ?'); params.push(query.floorId); }
  if (query.tableId) { conditions.push('o.TableId = ?'); params.push(query.tableId); }
  if (conditions.length === 0) return { clause: '', params: [] };

  return {
    clause:
      ` AND EXISTS (
          SELECT 1
            FROM pos_bill b
            JOIN pos_bill_order bo ON bo.BillId = b.Id AND bo.TenantId = b.TenantId
            JOIN pos_order o       ON o.Id = bo.OrderId AND o.TenantId = bo.TenantId
           WHERE b.TransactionDetailLogId = ${logAlias}.Id
             AND b.TenantId = ${logAlias}.TenantId
             AND ${conditions.join(' AND ')}
        )`,
    params,
  };
};

module.exports = { venueFilter };
