// src/modules/posdine/dine.context.service.js
// Turning a scanned token into WHERE the guest is.
//
// The token is the only input. Tenant, branch and table come from the database
// and never from the URL or the body, so a guest cannot address another table
// by editing a request. Unknown, rotated, retired and switched-off codes all
// answer the same 404, so nobody can probe which codes exist.

const { withConnection } = require('../../utils/dbHelper');
const MESSAGES = require('../../config/messages');
const { HttpError } = require('../../middleware/errorHandler');
const qrRepository = require('../posqr/posqr.repository');
const qrSettings = require('../posqr/posqr.settings.service');
const posMedia = require('../posmedia/posmedia.service');
const { isWellFormed } = require('../posqr/posqr.token');

const notAvailable = () => new HttpError(MESSAGES.ERROR.QR_NOT_AVAILABLE, 404);

/**
 * @param {string} token - From the QR code.
 * @returns {Promise<Object>} Internal context: ids plus what the guest is shown.
 * @throws {HttpError} 404 for every way a code can fail to work.
 */
const resolve = async (token) => {
  if (!isWellFormed(token)) throw notAvailable();
  return withConnection(async (conn) => {
    const row = await qrRepository.findByTokenTx(conn, token);
    if (!row) throw notAvailable();
    const settings = await qrSettings.getSettingsTx(conn, row.BranchDetailId, row.TenantId);
    if (!settings.enabled) throw notAvailable();
    return {
      qrId: row.QrId,
      tenantId: row.TenantId,
      branchId: row.BranchDetailId,
      tableId: row.TableId,
      tableName: row.TableName,
      floorName: row.FloorName || null,
      branchName: row.BranchName || null,
      businessName: row.BusinessName || null,
      settings,
    };
  });
};

/** What the landing screen may show. No ids leave the server here. */
const toPublic = (ctx) => ({
  businessName: ctx.businessName,
  branchName: ctx.branchName,
  tableName: ctx.tableName,
  floorName: ctx.floorName,
  mode: ctx.settings.mode,
  canOrder: ctx.settings.canOrder,
});

/**
 * The branch logo for the landing screen, or null when it has none.
 * @param {Object} ctx - From resolve().
 */
const getLogo = async (ctx) => {
  try {
    const media = await posMedia.get('logo', ctx.branchId, ctx.tenantId);
    return { mimeType: media.mimeType, dataUri: media.dataUri, updatedOn: media.updatedOn };
  } catch (err) {
    if (err instanceof HttpError && err.statusCode === 404) return null;
    throw err;
  }
};

module.exports = { resolve, toPublic, getLogo };
