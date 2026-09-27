// src/utils/fieldLimits.js
//
// ONE place that states how long each column actually is.
//
// WHY THIS EXISTS
// The wizard accepted a 200-character branch name for a VARCHAR(50) column. On a
// server running the MySQL 8 default sql_mode (STRICT_TRANS_TABLES) that is a 500
// with the whole bootstrap rolled back, and the user is told "Nothing was saved."
// with no reason; on a non-strict server it is a silent truncation, and the
// truncated name then prints on every bill. Neither is acceptable, and which one
// you get depends on a server setting nobody in this repository controls.
//
// Four schema files plus the frontend all needed the same numbers. Written as
// literals in each, they drift — the same reasoning as utils/gstinSchema.js:
// "Three copies of a pattern is how one of them ends up accepting a pasted
// phone number."
//
// KEEP THIS IN STEP WITH database/01-schema-definition.sql. Line references are
// given so a reader can check a value without grepping. config/schemaCheck.js
// cross-checks every entry here against information_schema at boot, so a drift
// is a startup log line rather than a production truncation.

const Joi = require('joi');

/**
 * table → column → maximum string length, taken from the DDL.
 * Only string columns belong here; numeric and date columns have their own rules.
 */
const LIMITS = Object.freeze({
  // 01-schema-definition.sql:531
  organizationdetail: { Name: 100 },

  // :845 — BranchName is VARCHAR(50), not 100. FSSAI added by migration 001.
  branchdetail: {
    BranchName: 50, TINNo: 50, GSTIN: 50, PAN: 50, FSSAI: 20,
    CF1: 50, CF2: 50, CF3: 50, CF4: 50,
  },

  // :802
  addressdetail: {
    AddressLine1: 50, AddressLine2: 50, City: 50, State: 50,
    Pincode: 50, Landmark: 50, TagName: 100,
  },

  // :778 — Email added by migration 001. The phone columns are VARCHAR(50) in
  // the DDL even though the existing Joi rules say 20; the tighter rule is kept
  // deliberately (a 50-character mobile number is not a mobile number), so these
  // record the COLUMN width and the schema may choose to be stricter.
  contactdetail: {
    FirstName: 50, LastName: 50, Email: 100,
    MobileNo: 50, AltMobileNo: 50, Landline1: 50, LandLine2: 50,
    Ext1: 50, Ext2: 50,
  },

  // :677
  contactaddresstype: { Name: 50 },

  // :475
  categorydetail: { Name: 50 },

  // :460
  UOM: { UnitName: 50 },

  // :691
  taxgroup: { Name: 50 },

  // :436
  TaxTypes: { Name: 50, Value: 50 },

  // :504
  transactiontypeconfig: { StartCounterNo: 50, Prefix: 50, Format: 100, TagName: 100 },

  // :921
  itemdetail: {
    Name: 255, Code: 50, Description: 1000, SKU: 50,
    Barcode: 50, HSNCode: 50, SACCode: 50,
  },

  // :828
  costinfo: { Amount: 50 },
});

/**
 * The maximum length of one column.
 * @param {string} table
 * @param {string} column
 * @returns {number}
 * @throws {Error} When the column is not recorded — a typo must not silently
 *   become "no limit", which is the bug this module exists to prevent.
 */
const maxOf = (table, column) => {
  const max = LIMITS[table] && LIMITS[table][column];
  if (!max) {
    throw new Error(
      `fieldLimits: no limit recorded for ${table}.${column}. `
      + 'Add it from database/01-schema-definition.sql.',
    );
  }
  return max;
};

/**
 * A required, trimmed string bounded by its column.
 * @param {string} table
 * @param {string} column
 * @returns {Object} Joi string schema
 */
const requiredStr = (table, column) =>
  Joi.string().trim().max(maxOf(table, column)).required();

/**
 * An optional, trimmed string bounded by its column. Blank and null both mean
 * "not given" — the wizard strips empties before sending, and an edit form that
 * clears a box sends ''.
 * @param {string} table
 * @param {string} column
 * @returns {Object} Joi string schema
 */
const optionalStr = (table, column) =>
  Joi.string().trim().max(maxOf(table, column)).allow('', null).optional();

/**
 * Every limit, flattened for the client: 'table.column' → max.
 * Served by GET /api/master-data/field-limits so an input's maxLength comes from
 * the same source as the validator rather than from a second copy of the numbers.
 * @returns {Object<string, number>}
 */
const flatLimits = () => {
  const out = {};
  Object.entries(LIMITS).forEach(([table, columns]) => {
    Object.entries(columns).forEach(([column, max]) => {
      out[`${table}.${column}`] = max;
    });
  });
  return out;
};

module.exports = { LIMITS, maxOf, requiredStr, optionalStr, flatLimits };
