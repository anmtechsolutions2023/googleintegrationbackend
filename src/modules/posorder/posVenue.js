// src/modules/posorder/posVenue.js
// Where a round was served, frozen at the moment it happened.
//
// pos_order carries TableName / FloorId / FloorName / TableCapacity as a COPY of
// the floor plan, not a reference to it. That is deliberate. A restaurant's floor
// plan is edited constantly — tables get renamed, moved between floors, merged,
// retired — and if reporting resolved those facts by joining pos_table at read
// time, then renaming "G-01" or moving it upstairs would silently rewrite months
// of history: revenue that was earned on the ground floor would start appearing
// on the roof.
//
// So the snapshot answers "where was this served?" and the live pos_table /
// pos_floor rows answer "where can I seat someone now?". Both questions are
// legitimate; they are simply not the same question.
//
// Same reasoning as the priced line snapshot on pos_order.Items, and as
// transactiondetaillog.CustomerName sitting beside ContactDetailId. Like those,
// these columns carry NO foreign key — a historical value must not stop the
// underlying master row from ever being retired.

const EMPTY_VENUE = {
  TableName: null,
  FloorId: null,
  FloorName: null,
  TableCapacity: null,
};

/**
 * Reads the venue facts for a table on an open transaction connection.
 *
 * Returns nulls for a takeaway/delivery round (no table) or a table that no
 * longer exists — an order still records what it can, rather than failing.
 *
 * @param {Object} conn - Active transaction connection.
 * @param {string|null} tableId
 * @param {string} tenantId
 * @returns {Promise<{TableName, FloorId, FloorName, TableCapacity}>}
 */
const resolveVenueTx = async (conn, tableId, tenantId) => {
  if (!tableId) return { ...EMPTY_VENUE };
  const [rows] = await conn.execute(
    `SELECT t.Name AS TableName, t.Capacity AS TableCapacity,
            t.FloorId AS FloorId, f.Name AS FloorName
       FROM pos_table t
       LEFT JOIN pos_floor f ON f.Id = t.FloorId AND f.TenantId = t.TenantId
      WHERE t.Id = ? AND t.TenantId = ?
      LIMIT 1`,
    [tableId, tenantId],
  );
  if (!rows || rows.length === 0) return { ...EMPTY_VENUE };
  const r = rows[0];
  return {
    TableName: r.TableName ?? null,
    FloorId: r.FloorId ?? null,
    FloorName: r.FloorName ?? null,
    TableCapacity: r.TableCapacity ?? null,
  };
};

module.exports = { resolveVenueTx, EMPTY_VENUE };
