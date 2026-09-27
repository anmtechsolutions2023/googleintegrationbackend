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
const { LIMITS } = require('../utils/fieldLimits');

const REQUIRED_COLUMNS = {
  // Venue snapshot — where a round was served, frozen at the time.
  pos_order: ['TableName', 'FloorId', 'FloorName', 'TableCapacity', 'CookingInstructions', 'NoCutlery'],
  // Per-item discounts granted on a bill.
  pos_bill: ['LineDiscounts'],
  // What the customer asked the kitchen for, snapshotted onto the ticket.
  pos_kot: ['CookingInstructions', 'NoCutlery'],
  // The per-dish share of a discount, split from the total borne by the line,
  // and the add-on surcharge + snapshot split out from the variant ones.
  // Written by LEDGER.INSERT_ITEM: a database without them fails EVERY bill
  // settlement with ER_BAD_FIELD_ERROR, which is exactly the unreadable
  // failure this check exists to name.
  // Note: the dish's kitchen note, carried to the invoice line.
  transactionitemdetail: ['ItemDiscountAmount', 'AddonAmount', 'Addons', 'Note', 'TaxCharged'],
  // GST switch + CA export. A database without these fails every settle
  // (TaxMode is written on each invoice header).
  transactiondetaillog: ['TaxMode', 'BuyerGstin', 'BuyerLegalName', 'SellerGstin'],
  pos_customer: ['GSTIN', 'LegalName'],
  pos_portal: ['GSTIN'],
  pos_tax_setting: ['GstCharging', 'OffReason'],
  pos_tax_mode_history: ['FromCharging', 'ToCharging'],
  pos_gst_filing: ['Period', 'FiledOn'],

  // ── Zomato / portal menu integration ──────────────────────────────────────
  // Sub-category tree and portal menu ordering.
  categorydetail: ['ParentId', 'SortOrder'],
  // GST 9(5): a bill can carry both goods and services, taxed differently.
  itemdetail: ['SupplyType', 'SACCode'],
  // What the dish IS beyond its price, plus its own preparation time.
  pos_item_meta: ['ServesCount', 'PortionSize', 'MeatTypeId', 'PrepTimeMinutes'],
  // Tenant profile (migration 001). A database without these fails every save on
  // the Business Profile screen and every onboarding that fills an optional field.
  // pos_branch_media is listed by a column rather than by existence because this
  // map is keyed on table → columns; a missing TABLE reports all of them missing,
  // which is the same loud outcome.
  branchdetail: ['FSSAI'],
  contactdetail: ['Email'],
  pos_branch_media: ['Kind', 'MimeType', 'Bytes', 'ByteSize'],
  // Kitchen promise, customer instructions, and the coded rejection.
  pos_online_order: [
    'KptMinutes',
    'KptSetOn',
    'CookingInstructions',
    'NoCutlery',
    'RejectionReasonId',
    'RejectedItemIds',
  ],
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

/**
 * Columns whose real width disagrees with utils/fieldLimits.js.
 *
 * fieldLimits is the source every Joi rule and every input's maxLength now reads
 * from, and it is maintained BY HAND from 01-schema-definition.sql. A hand-kept
 * mirror of the schema drifts, and the way it fails is the worst kind: a limit
 * that is too high lets an over-length value reach MySQL, where it is either a
 * 500 with a rolled-back transaction or — on a non-strict sql_mode — a silent
 * truncation that then prints on every bill.
 *
 * So the mirror is checked against the real thing once, at boot.
 *
 * @returns {Promise<Array<{column:string, declared:number, actual:number}>>}
 */
const findLimitDrift = async () =>
  withConnection(async (conn) => {
    const tables = Object.keys(LIMITS);
    const placeholders = tables.map(() => '?').join(', ');
    const [rows] = await conn.execute(
      `SELECT TABLE_NAME, COLUMN_NAME, CHARACTER_MAXIMUM_LENGTH AS len
         FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME IN (${placeholders})
          AND CHARACTER_MAXIMUM_LENGTH IS NOT NULL`,
      tables,
    );

    const actual = new Map(
      rows.map((r) => [`${r.TABLE_NAME}.${r.COLUMN_NAME}`, Number(r.len)]),
    );

    const drift = [];
    Object.entries(LIMITS).forEach(([table, columns]) => {
      Object.entries(columns).forEach(([column, declared]) => {
        const key = `${table}.${column}`;
        const real = actual.get(key);
        // Absent means the column is missing, which findMissingColumns already
        // reports for the tables it watches. Not this check's job to say twice.
        if (real !== undefined && real !== declared) {
          drift.push({ column: key, declared, actual: real });
        }
      });
    });
    return drift;
  });

/**
 * Logs when fieldLimits and the database disagree. Never throws, for the same
 * reason as assertSchemaIsCurrent.
 */
const assertLimitsMatchSchema = async () => {
  try {
    const drift = await findLimitDrift();
    if (drift.length === 0) return true;

    const detail = drift
      .map((d) => `${d.column} declared ${d.declared}, column is ${d.actual}`)
      .join(' | ');
    logger.error(
      'FIELD LIMITS DISAGREE WITH THE DATABASE — a limit above the real column '
      + 'width lets an over-length value reach MySQL, which either 500s or '
      + `truncates silently. Fix src/utils/fieldLimits.js → ${detail}`,
      { drift },
    );
    return false;
  } catch (err) {
    logger.warn('Field-limit check could not run', { error: err.message });
    return true;
  }
};

module.exports = {
  assertSchemaIsCurrent,
  findMissingColumns,
  REQUIRED_COLUMNS,
  assertLimitsMatchSchema,
  findLimitDrift,
};
