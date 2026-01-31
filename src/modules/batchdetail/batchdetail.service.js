// src/modules/batchdetail/batchdetail.service.js
const BaseCRUDService = require('../../common/BaseCRUDService');
const { QUERIES } = require('../../config/constants');

class BatchDetailService extends BaseCRUDService {
  constructor() {
    super('Batch Detail', QUERIES.BATCH_DETAIL);
  }

  prepareInsertParams(id, data, tenantId, userEmail) {
    return [
      id,
      tenantId,
      data.BatchNumber,
      data.ManufacturedDate || null,
      data.ExpiryDate || null,
      data.Active !== undefined ? data.Active : true,
      userEmail,
      userEmail,
    ];
  }

  prepareUpdateParams(data, existing, userEmail, id, tenantId) {
    return [
      data.BatchNumber !== undefined ? data.BatchNumber : existing.BatchNumber,
      data.ManufacturedDate !== undefined
        ? data.ManufacturedDate
        : existing.ManufacturedDate,
      data.ExpiryDate !== undefined ? data.ExpiryDate : existing.ExpiryDate,
      data.Active !== undefined ? data.Active : existing.Active,
      userEmail,
      id,
      tenantId,
    ];
  }
}

const service = new BatchDetailService();
module.exports = {
  getAll: (tenantId, page, limit) => service.getAll(tenantId, page, limit),
  getById: (id, tenantId) => service.getById(id, tenantId),
  create: (data, tenantId, userEmail) =>
    service.create(data, tenantId, userEmail),
  update: (id, data, tenantId, userEmail) =>
    service.update(id, data, tenantId, userEmail),
  delete: (id, tenantId) => service.delete(id, tenantId),
};
