// src/modules/posonlineorder/posonlineorder.service.js
// POS Online Order service — business logic extending BaseCRUDService (SRP + DIP).

const BaseCRUDService = require('../../common/BaseCRUDService');
const { QUERIES } = require('../../config/constants');

// Serialize object/array values for JSON columns; pass through strings and null.
const toJson = (v) => (v == null ? null : typeof v === 'string' ? v : JSON.stringify(v));

class PosOnlineOrderService extends BaseCRUDService {
  constructor() {
    super('POS Online Order', QUERIES.POS_ONLINE_ORDER);
  }

  prepareInsertParams(id, data, tenantId, userEmail) {
    return [
      id,
      tenantId,
      data.Platform ?? null,
      data.ExternalRef ?? null,
      data.Status ?? null,
      toJson(data.Payload),
      data.BranchDetailId ?? null,
      data.Active !== undefined ? data.Active : true,
      userEmail,
      userEmail,
    ];
  }

  prepareUpdateParams(data, existing, userEmail, id, tenantId) {
    return [
      data.Platform !== undefined ? data.Platform : existing.Platform,
      data.ExternalRef !== undefined ? data.ExternalRef : existing.ExternalRef,
      data.Status !== undefined ? data.Status : existing.Status,
      data.Payload !== undefined ? toJson(data.Payload) : toJson(existing.Payload),
      data.BranchDetailId !== undefined ? data.BranchDetailId : existing.BranchDetailId,
      data.Active !== undefined ? data.Active : existing.Active,
      userEmail,
      id,
      tenantId,
    ];
  }
}

const service = new PosOnlineOrderService();

module.exports = {
  getAll: (tenantId, page, limit) => service.getAll(tenantId, page, limit),
  getById: (id, tenantId) => service.getById(id, tenantId),
  create: (data, tenantId, userEmail) => service.create(data, tenantId, userEmail),
  update: (id, data, tenantId, userEmail) => service.update(id, data, tenantId, userEmail),
  remove: (id, tenantId) => service.delete(id, tenantId),
};
