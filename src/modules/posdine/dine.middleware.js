// src/modules/posdine/dine.middleware.js
// authenticateDiner — the diner-side counterpart of authenticateToken.
//
// Beyond the signature and expiry, it RE-READS the QR code the session was
// opened with on every request. Rotating a table's code, retiring the table or
// switching QR ordering off for the branch must end sessions that are already
// open, not merely stop new scans — a guest who photographed the card and left
// should lose access the moment staff rotate it.
//
// Attaches req.diner: every id a diner route may use. Nothing a diner route
// does reads a tenant, branch, table or customer id from the request itself.

const MESSAGES = require('../../config/messages');
const { HttpError } = require('../../middleware/errorHandler');
const { withConnection } = require('../../utils/dbHelper');
const qrRepository = require('../posqr/posqr.repository');
const qrSettings = require('../posqr/posqr.settings.service');
const session = require('./dine.session');
const sessionEnd = require('./dine.sessionend.service');

const ended = () => new HttpError(MESSAGES.ERROR.QR_SESSION_ENDED, 401, 'DINER_SESSION_ENDED');

const bearerOf = (req) => {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  return scheme === 'Bearer' && token ? token : null;
};

const authenticateDiner = async (req, res, next) => {
  try {
    const token = bearerOf(req);
    if (!token) throw ended();

    let claims;
    try {
      claims = session.verify(token);
    } catch {
      throw ended();
    }

    const startedAt = new Date(claims.iat * 1000);

    const live = await withConnection(async (conn) => {
      const qr = await qrRepository.findActiveByIdTx(conn, claims.qrId);
      if (!qr || qr.TenantId !== claims.tid || qr.TableId !== claims.tableId) return null;
      const settings = await qrSettings.getSettingsTx(conn, qr.BranchDetailId, qr.TenantId);
      if (!settings.enabled) return null;
      // PAYING ENDS THE MEAL. Checked on the same read as the code itself, for
      // the same reason: a session has to stop the moment its table is settled,
      // not whenever the token happens to expire. Otherwise a guest who has paid
      // and left keeps ordering onto a table staff have finished with.
      if (await sessionEnd.isEnded(conn, qr.TableId, qr.TenantId, startedAt)) return null;
      return { qr, settings };
    });
    if (!live) throw ended();

    req.diner = {
      phone: claims.phone,
      tenantId: claims.tid,
      branchId: live.qr.BranchDetailId,
      tableId: claims.tableId,
      qrId: claims.qrId,
      customerId: claims.customerId,
      sessionStartedAt: startedAt,
      settings: live.settings,
    };
    return next();
  } catch (err) {
    return next(err);
  }
};

module.exports = { authenticateDiner };
