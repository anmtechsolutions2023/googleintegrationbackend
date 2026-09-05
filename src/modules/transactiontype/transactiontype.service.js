// src/modules/transactiontype/transactiontype.service.js
const BaseCRUDService = require('../../common/BaseCRUDService');
const { QUERIES } = require('../../config/constants');
const { logger } = require('../../utils/logger');

class TransactionTypeService extends BaseCRUDService {
  constructor() {
    super('Transaction Type', QUERIES.TRANSACTION_TYPE);
  }

  prepareInsertParams(id, data, tenantId, userPhone) {
    return [
      id,
      tenantId,
      data.Name,
      data.TransactionTypeConfigId,
      data.Active !== undefined ? data.Active : true,
      userPhone,
      userPhone,
    ];
  }

  prepareUpdateParams(data, existing, userPhone, id, tenantId) {
    return [
      data.Name !== undefined ? data.Name : existing.Name,
      data.TransactionTypeConfigId !== undefined ? data.TransactionTypeConfigId : existing.TransactionTypeConfigId,
      data.Active !== undefined ? data.Active : existing.Active,
      userPhone,
      id,
      tenantId,
    ];
  }
}

const service = new TransactionTypeService();
module.exports = {
  getAll: (tenantId, page, limit, expand) => service.getAll(tenantId, page, limit, expand),
  getById: (id, tenantId, expand) => service.getById(id, tenantId, expand),
  create: (data, tenantId, userPhone) =>
    service.create(data, tenantId, userPhone),
  update: (id, data, tenantId, userPhone) =>
    service.update(id, data, tenantId, userPhone),
  delete: (id, tenantId) => service.delete(id, tenantId),
};
