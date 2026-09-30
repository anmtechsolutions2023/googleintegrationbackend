// src/modules/posqr/posqr.codes.service.js
// Issuing, listing and rotating the code printed on each table.
//
// Codes are issued LAZILY: the first time someone opens a branch's QR sheet,
// every table without a code gets one in the same call, so "print all" is a
// single request and table CRUD never has to know QR codes exist.

const { withTransaction } = require('../../utils/dbHelper');
const MESSAGES = require('../../config/messages');
const { HttpError } = require('../../middleware/errorHandler');
const { logger } = require('../../utils/logger');
const repository = require('./posqr.repository');
const { generateToken } = require('./posqr.token');

/** The public shape of one table's code. The token is what the QR encodes. */
const toCode = (row) => ({
  tableId: row.TableId,
  tableName: row.TableName,
  capacity: row.Capacity ?? null,
  floorId: row.FloorId ?? null,
  floorName: row.FloorName ?? null,
  qrId: row.QrId,
  token: row.Token,
  issuedOn: row.IssuedOn ?? null,
  rotatedOn: row.RotatedOn ?? null,
});

/**
 * Every table in a branch with its code, issuing the missing ones.
 * @param {string} branchId
 * @param {string} tenantId
 * @param {string} userPhone
 * @returns {Promise<{branchId: string, issued: number, codes: Array<Object>}>}
 */
const listForBranch = async (branchId, tenantId, userPhone) =>
  withTransaction(async (conn) => {
    const rows = await repository.listBranchTablesTx(conn, branchId, tenantId);
    const missing = rows.filter((r) => !r.Token);
    for (const row of missing) {
      await repository.insertCodeTx(conn, {
        token: generateToken(), tableId: row.TableId, branchId,
      }, tenantId, userPhone);
    }
    const final = missing.length > 0
      ? await repository.listBranchTablesTx(conn, branchId, tenantId)
      : rows;
    if (missing.length > 0) {
      logger.info('QR codes issued', { tenantId, branchId, issued: missing.length });
    }
    return { branchId, issued: missing.length, codes: final.map(toCode) };
  });

/**
 * A new token for one table. The printed card stops working at once, and any
 * diner session opened with the old token fails its next request.
 * @param {string} tableId
 * @param {string} tenantId
 * @param {string} userPhone
 * @returns {Promise<Object>} The table's new code.
 */
const rotate = async (tableId, tenantId, userPhone) =>
  withTransaction(async (conn) => {
    const table = await repository.findTableTx(conn, tableId, tenantId);
    if (!table) throw new HttpError(MESSAGES.ERROR.QR_TABLE_NOT_FOUND, 404);
    if (!table.BranchDetailId) throw new HttpError(MESSAGES.ERROR.QR_TABLE_NO_BRANCH, 409);

    const code = { token: generateToken(), tableId, branchId: table.BranchDetailId };
    const existed = await repository.rotateCodeTx(conn, code, tenantId, userPhone);
    if (!existed) await repository.insertCodeTx(conn, code, tenantId, userPhone);

    logger.warn('QR code rotated', { tenantId, tableId, by: userPhone });
    const rows = await repository.listBranchTablesTx(conn, table.BranchDetailId, tenantId);
    return toCode(rows.find((r) => r.TableId === tableId));
  });

module.exports = { listForBranch, rotate, toCode };
