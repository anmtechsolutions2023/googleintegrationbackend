// src/modules/poskot/poskot.service.js
// POS KOT service — business logic extending BaseCRUDService (SRP + DIP).

const BaseCRUDService = require('../../common/BaseCRUDService');
const { QUERIES } = require('../../config/constants');
const { withConnection, withTransaction } = require('../../utils/dbHelper');
const { issuePosNumber } = require('../posorder/posNumbering');

// Serialize object/array values for JSON columns; pass through strings and null.
const toJson = (v) => (v == null ? null : typeof v === 'string' ? v : JSON.stringify(v));

class PosKotService extends BaseCRUDService {
  constructor() {
    super('POS KOT', QUERIES.POS_KOT);
  }

  /**
   * Create a KOT directly (rounds fire their own; this is the manual path).
   *
   * KotNo comes from the POS_KOT series when the caller omits it. The column is
   * NOT NULL, and the value clients used to send was the raw epoch in
   * milliseconds, which is what the kitchen display then showed as the ticket
   * number.
   */
  async create(data, tenantId, userPhone) {
    if (data.KotNo) return super.create(data, tenantId, userPhone);
    return withTransaction(async (connection) => {
      const KotNo = await issuePosNumber(connection, 'POS_KOT', 'KOT', tenantId, userPhone);
      return this.createTx(connection, { ...data, KotNo }, tenantId, userPhone);
    });
  }

  /**
   * Domain action: mark a KOT ready (KDS "Mark All Ready").
   * @param {string} id - KOT ID
   * @param {string} tenantId - Tenant ID
   * @param {string} userPhone - Acting user
   * @param {string} [status='ready'] - Target status
   * @returns {Promise<Object>} Updated KOT
   */
  async setStatus(id, tenantId, userPhone, status = 'ready') {
    // Both reads borrow THIS connection. Without the 4th argument each took a
    // second one from the pool while the outer withConnection still held the
    // first, so one "Mark Ready" cost three acquisitions and held two at once.
    // At CONNECTION_LIMIT 4 that is four cooks tapping Ready between them:
    // every one holds a connection and waits for another nobody is left to
    // release, and mysql2 has no acquire timeout, so the wait never ends. The
    // KDS saw it as a request that hung until the client gave up at 30s —
    // "Failed to mark KOT ready" — and the wedged pool then hung the whole app.
    return withConnection(async (connection) => {
      await this.getById(id, tenantId, false, connection); // 404 if missing
      await connection.execute(this.queries.SET_STATUS, [
        status,
        userPhone,
        id,
        tenantId,
      ]);
      return this.getById(id, tenantId, false, connection);
    });
  }

  prepareInsertParams(id, data, tenantId, userPhone) {
    return [
      id,
      tenantId,
      data.KotNo ?? null,
      data.OrderId ?? null,
      data.TableId ?? null,
      toJson(data.Items),
      data.Status ?? null,
      data.FiredAt ?? null,
      data.BranchDetailId ?? null,
      data.Active !== undefined ? data.Active : true,
      userPhone,
      userPhone,
    ];
  }

  prepareUpdateParams(data, existing, userPhone, id, tenantId) {
    return [
      data.KotNo !== undefined ? data.KotNo : existing.KotNo,
      data.OrderId !== undefined ? data.OrderId : existing.OrderId,
      data.TableId !== undefined ? data.TableId : existing.TableId,
      data.Items !== undefined ? toJson(data.Items) : toJson(existing.Items),
      data.Status !== undefined ? data.Status : existing.Status,
      data.FiredAt !== undefined ? data.FiredAt : existing.FiredAt,
      data.BranchDetailId !== undefined ? data.BranchDetailId : existing.BranchDetailId,
      data.Active !== undefined ? data.Active : existing.Active,
      userPhone,
      id,
      tenantId,
    ];
  }
}

const service = new PosKotService();

module.exports = {
  getAll: (tenantId, page, limit) => service.getAll(tenantId, page, limit),
  getById: (id, tenantId) => service.getById(id, tenantId),
  create: (data, tenantId, userPhone) => service.create(data, tenantId, userPhone),
  update: (id, data, tenantId, userPhone) => service.update(id, data, tenantId, userPhone),
  remove: (id, tenantId) => service.delete(id, tenantId),
  markReady: (id, tenantId, userPhone) => service.setStatus(id, tenantId, userPhone, 'ready'),
};
