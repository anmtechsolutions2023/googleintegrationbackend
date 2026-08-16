// src/config/schemaCheck.js
// Boot-time check that the database actually has the columns this code writes.
//
// This project deploys by recreating the database from 01-schema-definition.sql
// rather than by migration, which means the schema and the code can drift apart
// whenever someone pulls new code without recreating. The failure that produces
// is genuinely hard to read: every affected write dies with a 500 and
// `ER_BAD_FIELD_ERROR: Unknown column 'X' in 'field list'`, which looks like a
// bug in the request payload rather than a stale database — the request that
// exposes it is usually blameless.
//
// So the check runs once at boot and names exactly which columns are missing and
// what to do about it. It does NOT fail startup: the rest of the API still works,
// and taking the whole service down over one stale table would be a worse outcome
// than a loud log line.
//
// Keep REQUIRED_COLUMNS to columns added AFTER a table's original definition —
// the ones a stale database is actually likely to be missing. It is a smoke
// alarm, not a schema validator.

const { withConnection } = require('../utils/dbHelper');
const { logger } = require('../utils/logger');

const REQUIRED_COLUMNS = {
  // Venue snapshot — where a round was served, frozen at the time.
  pos_order: ['TableName', 'FloorId', 'FloorName', 'TableCapacity'],
  // Per-item discounts granted on a bill.
  pos_bill: ['LineDiscounts'],
  // The per-dish share of a discount, split from the total borne by the line.
  transactionitemdetail: ['ItemDiscountAmount'],
};

/**
 * Reports any missing columns.
 * @returns {Promise<Array<{table:string, missing:string[]}>>}
 */
const findMissingColumns = async () =>
  withConnection(async (conn) => {
    const tables = Object.keys(REQUIRED_COLUMNS);
    const placeholders = tables.map(() => '?').join(', ');
    const [rows] = await conn.execute(
      `SELECT TABLE_NAME, COLUMN_NAME
         FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME IN (${placeholders})`,
      tables,
    );

    const present = new Map(tables.map((t) => [t, new Set()]));
    rows.forEach((r) => {
      const t = present.get(r.TABLE_NAME) || present.get(String(r.TABLE_NAME).toLowerCase());
      if (t) t.add(r.COLUMN_NAME);
    });

    return tables
      .map((table) => ({
        table,
        missing: REQUIRED_COLUMNS[table].filter((c) => !present.get(table).has(c)),
      }))
      .filter((r) => r.missing.length > 0);
  });

/**
 * Logs a loud, actionable message when the database is behind the code.
 *
 * Never throws: a check that can take the server down is a check that gets
 * deleted the first time it misfires.
 */
const assertSchemaIsCurrent = async () => {
  try {
    const drift = await findMissingColumns();
    if (drift.length === 0) {
      logger.info('Schema check passed — database matches this build');
      return true;
    }

    const detail = drift.map((d) => `${d.table}: ${d.missing.join(', ')}`).join(' | ');
    logger.error(
      'DATABASE IS BEHIND THIS BUILD — writes to these tables will fail with ' +
      `"Unknown column". Missing → ${detail}. ` +
      'Recreate the database from database/01-schema-definition.sql + 02-seed-data.sql.',
      { drift },
    );
    return false;
  } catch (err) {
    // A database that cannot be reached is a different problem, reported
    // elsewhere; do not let this check add noise to it.
    logger.warn('Schema check could not run', { error: err.message });
    return true;
  }
};

module.exports = { assertSchemaIsCurrent, findMissingColumns, REQUIRED_COLUMNS };
