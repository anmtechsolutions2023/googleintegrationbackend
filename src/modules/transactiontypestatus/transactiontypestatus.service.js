// src/modules/transactiontypestatus/transactiontypestatus.service.js
const BaseCRUDService = require('../../common/BaseCRUDService');
const { QUERIES } = require('../../config/constants');

class TransactionTypeStatusService extends BaseCRUDService {
  constructor() {
    super('Transaction Type Status', QUERIES.TRANSACTION_TYPE_STATUS);
  }

  prepareInsertParams(id, data, tenantId, userPhone) {
    return [
      id,
      tenantId,
      data.Name,
      data.Active !== undefined ? data.Active : true,
      userPhone,
      userPhone,
    ];
  }

  prepareUpdateParams(data, existing, userPhone, id, tenantId) {
    return [
      data.Name !== undefined ? data.Name : existing.Name,
      data.Active !== undefined ? data.Active : existing.Active,
      userPhone,
      id,
      tenantId,
    ];
  }
}

const service = new TransactionTypeStatusService();
module.exports = {
  getAll: (tenantId, page, limit) => service.getAll(tenantId, page, limit),
  getById: (id, tenantId) => service.getById(id, tenantId),
  create: (data, tenantId, userPhone) =>
    service.create(data, tenantId, userPhone),
  update: (id, data, tenantId, userPhone) =>
    service.update(id, data, tenantId, userPhone),
  delete: (id, tenantId) => service.delete(id, tenantId),
};
