// src/modules/pricing/pricing.repository.js
// Data access for the tax chain: costinfo → taxgroup → mapper → TaxTypes.
//
// Repository rather than service, for the same reason as mastersetup.repository:
// several modules (costinfo, itemdetail, positemmeta, batchdetail, POS orders)
// need pricing, and none of them should have to pull in a CRUD service to get it.
//
// Everything here is BATCHED. Pricing a 20-line order must be one query, not 20.

const { withConnection } = require('../../utils/dbHelper');
const { QUERIES } = require('../../config/constants');

/**
 * Expands a `:ids` placeholder into the right number of `?` bind params.
 * mysql2's execute() does not expand arrays, and interpolating ids directly
 * would be an injection risk — so the COUNT of placeholders is generated and
 * the values still travel as bound parameters.
 * @param {string} sql
 * @param {number} count
 * @returns {string}
 */
const expandIdPlaceholders = (sql, count) =>
  sql.replace(':ids', new Array(count).fill('?').join(', '));

/**
 * Folds the flat (costinfo × tax type) join result into one entry per costinfo.
 * @param {Array<Object>} rows
 * @returns {Map<string, Object>}
 */
const groupChainRows = (rows) => {
  const byCostInfo = new Map();

  rows.forEach((row) => {
    let entry = byCostInfo.get(row.CostInfoId);
    if (!entry) {
      entry = {
        costInfoId: row.CostInfoId,
        amount: row.Amount,
        // TINYINT(1) arrives as 0/1
        isTaxIncluded: row.IsTaxIncluded === 1 || row.IsTaxIncluded === true,
        taxGroupId: row.TaxGroupId ?? null,
        taxGroupName: row.TaxGroupName ?? null,
        components: [],
      };
      byCostInfo.set(row.CostInfoId, entry);
    }
    // LEFT JOINs mean a costinfo with an exempt/empty group yields one row with
    // a null TaxTypeId — that is a valid 0% group, not a missing component.
    if (row.TaxTypeId) {
      entry.components.push({
        id: row.TaxTypeId,
        name: row.TaxTypeName,
        rate: row.TaxTypeValue,
      });
    }
  });

  return byCostInfo;
};

/**
 * Loads the full tax chain for a set of costinfo ids, in ONE query.
 * @param {string[]} costInfoIds - Unique costinfo ids.
 * @param {string} tenantId - Tenant ID.
 * @returns {Promise<Map<string, Object>>} costInfoId → { amount, isTaxIncluded, components[] }
 */
const getChainForCostInfos = async (costInfoIds, tenantId) => {
  const ids = [...new Set((costInfoIds || []).filter(Boolean))];
  if (ids.length === 0) return new Map();

  return withConnection(async (conn) => {
    const sql = expandIdPlaceholders(
      QUERIES.PRICING.SELECT_CHAIN_BY_COSTINFO_IDS,
      ids.length,
    );
    const [rows] = await conn.execute(sql, [tenantId, ...ids]);
    return groupChainRows(rows);
  });
};

/**
 * Loads one tax group's active components — for UI display of a group's rate.
 * @param {string} taxGroupId - Tax group ID.
 * @param {string} tenantId - Tenant ID.
 * @returns {Promise<Object|null>} { taxGroupId, taxGroupName, components[] } or null.
 */
const getTaxGroupComponents = (taxGroupId, tenantId) =>
  withConnection(async (conn) => {
    const [rows] = await conn.execute(QUERIES.PRICING.SELECT_CHAIN_BY_GROUP_ID, [
      tenantId,
      taxGroupId,
    ]);
    if (!rows || rows.length === 0) return null;

    return {
      taxGroupId: rows[0].TaxGroupId,
      taxGroupName: rows[0].TaxGroupName,
      components: rows
        .filter((r) => r.TaxTypeId)
        .map((r) => ({ id: r.TaxTypeId, name: r.TaxTypeName, rate: r.TaxTypeValue })),
    };
  });

module.exports = {
  getChainForCostInfos,
  getTaxGroupComponents,
  // exported for unit tests
  expandIdPlaceholders,
  groupChainRows,
};
