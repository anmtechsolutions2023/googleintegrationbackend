// src/modules/poskot/poskot.service.js
// POS KOT service — business logic extending BaseCRUDService (SRP + DIP).

const BaseCRUDService = require('../../common/BaseCRUDService');
const { QUERIES } = require('../../config/constants');
const { withConnection } = require('../../utils/dbHelper');

// Serialize object/array values for JSON columns; pass through strings and null.
const toJson = (v) => (v == null ? null : typeof v === 'string' ? v : JSON.stringify(v));

class PosKotService extends BaseCRUDService {
  constructor() {
    super('POS KOT', QUERIES.POS_KOT);
  }

  /**
   * Domain action: mark a KOT ready (KDS "Mark All Ready").
   * @param {string} id - KOT ID
   * @param {string} tenantId - Tenant ID
   * @param {string} userEmail - Acting user
   * @param {string} [status='ready'] - Target status
   * @returns {Promise<Object>} Updated KOT
   */
  async setStatus(id, tenantId, userEmail, status = 'ready') {
    return withConnection(async (connection) => {
      await this.getById(id, tenantId); // 404 if missing (reuses base + HttpError)
      await connection.execute(this.queries.SET_STATUS, [
        status,
        userEmail,
        id,
        tenantId,
      ]);
      return this.getById(id, tenantId);
    });
  }

  prepareInsertParams(id, data, tenantId, userEmail) {
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
      userEmail,
      userEmail,
    ];
  }

  prepareUpdateParams(data, existing, userEmail, id, tenantId) {
    return [
      data.KotNo !== undefined ? data.KotNo : existing.KotNo,
      data.OrderId !== undefined ? data.OrderId : existing.OrderId,
      data.TableId !== undefined ? data.TableId : existing.TableId,
      data.Items !== undefined ? toJson(data.Items) : toJson(existing.Items),
      data.Status !== undefined ? data.Status : existing.Status,
      data.FiredAt !== undefined ? data.FiredAt : existing.FiredAt,
      data.BranchDetailId !== undefined ? data.BranchDetailId : existing.BranchDetailId,
      data.Active !== undefined ? data.Active : existing.Active,
      userEmail,
      id,
      tenantId,
    ];
  }
}

const service = new PosKotService();

module.exports = {
  getAll: (tenantId, page, limit) => service.getAll(tenantId, page, limit),
  getById: (id, tenantId) => service.getById(id, tenantId),
  create: (data, tenantId, userEmail) => service.create(data, tenantId, userEmail),
  update: (id, data, tenantId, userEmail) => service.update(id, data, tenantId, userEmail),
  remove: (id, tenantId) => service.delete(id, tenantId),
  markReady: (id, tenantId, userEmail) => service.setStatus(id, tenantId, userEmail, 'ready'),
};
