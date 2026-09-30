// src/modules/posqr/posqr.repository.js
// Data access for printed table codes. SQL lives in QUERIES.POS_TABLE_QR; this
// file only binds parameters and shapes rows, so every service above it can be
// tested against a stub of these functions.

const { v4: uuidv4 } = require('uuid');
const { QUERIES } = require('../../config/constants');

const Q = QUERIES.POS_TABLE_QR;

/** Every live table of a branch, with its code when one has been issued. */
const listBranchTablesTx = async (conn, branchId, tenantId) => {
  const [rows] = await conn.execute(Q.SELECT_BRANCH_TABLES, [tenantId, branchId]);
  return rows;
};

/** One live table and the branch it sits in, or null. */
const findTableTx = async (conn, tableId, tenantId) => {
  const [rows] = await conn.execute(Q.SELECT_TABLE, [tableId, tenantId]);
  return rows[0] || null;
};

/** Issues a code for a table that has none. Idempotent per table. */
const insertCodeTx = async (conn, { token, tableId, branchId }, tenantId, userPhone) => {
  await conn.execute(Q.INSERT, [
    uuidv4(), token, tableId, branchId, tenantId, userPhone, userPhone,
  ]);
};

/** Replaces a table's token. @returns {Promise<boolean>} whether a code existed. */
const rotateCodeTx = async (conn, { token, tableId, branchId }, tenantId, userPhone) => {
  const [result] = await conn.execute(Q.ROTATE, [token, branchId, userPhone, tableId, tenantId]);
  return result.affectedRows > 0;
};

/** The public resolve: token → tenant, branch, table and the names to show. */
const findByTokenTx = async (conn, token) => {
  const [rows] = await conn.execute(Q.SELECT_BY_TOKEN, [token]);
  return rows[0] || null;
};

/** Whether a code a diner session was opened with is still live. */
const findActiveByIdTx = async (conn, qrId) => {
  const [rows] = await conn.execute(Q.SELECT_ACTIVE_BY_ID, [qrId]);
  return rows[0] || null;
};

module.exports = {
  listBranchTablesTx,
  findTableTx,
  insertCodeTx,
  rotateCodeTx,
  findByTokenTx,
  findActiveByIdTx,
};
