// src/modules/postable/postable.service.js
// POS Table service — business logic extending BaseCRUDService (SRP + DIP).

const BaseCRUDService = require('../../common/BaseCRUDService');
const { QUERIES } = require('../../config/constants');

class PosTableService extends BaseCRUDService {
  constructor() {
    super('POS Table', QUERIES.POS_TABLE);
  }

  prepareInsertParams(id, data, tenantId, userEmail) {
    return [
      id,
      tenantId,
      data.Name ?? null,
      data.FloorId ?? null,
      data.Capacity ?? null,
      data.Status ?? null,
      data.CurrentOrderId ?? null,
      data.BranchDetailId ?? null,
      data.Active !== undefined ? data.Active : true,
      userEmail,
      userEmail,
    ];
  }

  prepareUpdateParams(data, existing, userEmail, id, tenantId) {
    return [
      data.Name !== undefined ? data.Name : existing.Name,
      data.FloorId !== undefined ? data.FloorId : existing.FloorId,
      data.Capacity !== undefined ? data.Capacity : existing.Capacity,
      data.Status !== undefined ? data.Status : existing.Status,
      data.CurrentOrderId !== undefined ? data.CurrentOrderId : existing.CurrentOrderId,
      data.BranchDetailId !== undefined ? data.BranchDetailId : existing.BranchDetailId,
      data.Active !== undefined ? data.Active : existing.Active,
      userEmail,
      id,
      tenantId,
    ];
  }
}

const service = new PosTableService();

module.exports = {
  getAll: (tenantId, page, limit) => service.getAll(tenantId, page, limit),
  getById: (id, tenantId) => service.getById(id, tenantId),
  create: (data, tenantId, userEmail) => service.create(data, tenantId, userEmail),
  update: (id, data, tenantId, userEmail) => service.update(id, data, tenantId, userEmail),
  remove: (id, tenantId) => service.delete(id, tenantId),
};
