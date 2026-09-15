// src/modules/taxsetting/taxsetting.repository.js
// Reads over pos_tax_setting and what surrounds it.
//
// Pricing calls `isGstCharging` on every quote and every order, so it stays one
// indexed primary-key read. No caching: a cache would mean the switch takes
// effect "eventually", and the guard that refuses a switch while orders are
// open only works if the very next order sees the new value.

const { withConnection } = require('../../utils/dbHelper');
const { QUERIES } = require('../../config/constants');
const { isGstin, normaliseGstin, placeOfSupply } = require('../../utils/gstStates');

// No row means charging — what every tenant did before this setting existed.
const DEFAULT = Object.freeze({ gstCharging: true, offReason: null, updatedOn: null, updatedBy: null });

const shape = (row) => (row
  ? {
    gstCharging: Number(row.GstCharging) === 1,
    offReason: Number(row.GstCharging) === 1 ? null : (row.OffReason || null),
    updatedOn: row.UpdatedOn ?? null,
    updatedBy: row.UpdatedBy ?? null,
  }
  : { ...DEFAULT });

/**
 * The tenant's GST setting, on an open connection.
 * @returns {Promise<{gstCharging:boolean, offReason:(string|null), updatedOn, updatedBy}>}
 */
const getTx = async (conn, tenantId) => {
  const [rows] = await conn.execute(QUERIES.TAX_SETTING.SELECT, [tenantId]);
  return shape(rows[0]);
};

const get = (tenantId) => withConnection((conn) => getTx(conn, tenantId));

/** The one question pricing asks. */
const isGstCharging = async (tenantId) => (await get(tenantId)).gstCharging;

const historyTx = async (conn, tenantId) => {
  const [rows] = await conn.execute(QUERIES.TAX_SETTING.SELECT_HISTORY, [tenantId]);
  return rows.map((r) => ({
    id: r.Id,
    fromCharging: Number(r.FromCharging) === 1,
    toCharging: Number(r.ToCharging) === 1,
    offReason: r.OffReason || null,
    changedBy: r.ChangedBy || null,
    changedOn: r.ChangedOn,
  }));
};

const openOrdersTx = async (conn, tenantId) => {
  const [rows] = await conn.execute(QUERIES.TAX_SETTING.SELECT_OPEN_ORDERS, [tenantId]);
  return rows.map((r) => ({
    id: r.Id,
    orderNo: r.OrderNo,
    orderType: r.OrderType,
    tableName: r.TableName || null,
    total: Number(r.Total) || 0,
    createdOn: r.CreatedOn,
  }));
};

/**
 * Every switch change up to a moment, oldest first.
 * @param {string} tenantId
 * @param {string} until - 'YYYY-MM-DD HH:MM:SS'
 */
const historyUntil = (tenantId, until) => withConnection(async (conn) => {
  const [rows] = await conn.execute(QUERIES.TAX_SETTING.SELECT_HISTORY_UNTIL, [tenantId, until]);
  return rows.map((r) => ({
    fromCharging: Number(r.FromCharging) === 1,
    toCharging: Number(r.ToCharging) === 1,
    offReason: r.OffReason || null,
    changedBy: r.ChangedBy || null,
    changedOn: r.ChangedOn,
  }));
});

/**
 * Every active branch with its GSTIN. `valid` is false for a value that was
 * saved before GSTINs were checked — shown so it can be fixed, not hidden.
 */
const branchesTx = async (conn, tenantId) => {
  const [rows] = await conn.execute(QUERIES.TAX_SETTING.SELECT_BRANCHES, [tenantId]);
  return rows.map((r) => {
    const gstin = normaliseGstin(r.GSTIN) || null;
    return {
      id: r.Id,
      name: r.BranchName || '',
      gstin,
      valid: !gstin || isGstin(gstin),
      placeOfSupply: placeOfSupply(gstin),
    };
  });
};

module.exports = {
  branchesTx,
  DEFAULT, getTx, get, isGstCharging, historyTx, openOrdersTx, historyUntil,
};
