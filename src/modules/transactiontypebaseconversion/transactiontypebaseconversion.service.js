// src/modules/transactiontypebaseconversion/transactiontypebaseconversion.service.js
const BaseCRUDService = require('../../common/BaseCRUDService');
const { QUERIES } = require('../../config/constants');

class TransactionTypeBaseConversionService extends BaseCRUDService {
  constructor() {
    super(
      'Transaction Type Base Conversion',
      QUERIES.TRANSACTION_TYPE_BASE_CONVERSION
    );
  }

  prepareInsertParams(id, data, tenantId, userPhone) {
    return [
      id,
      tenantId,
      data.TransactionTypeConfigId,
      data.FromTransactionTypeStatusId,
      data.ToTransactionTypeStatusId,
      data.Tag || null,
      data.Active !== undefined ? data.Active : true,
      userPhone,
      userPhone,
    ];
  }

  prepareUpdateParams(data, existing, userPhone, id, tenantId) {
    return [
      data.TransactionTypeConfigId !== undefined ? data.TransactionTypeConfigId : existing.TransactionTypeConfigId,
      data.FromTransactionTypeStatusId !== undefined ? data.FromTransactionTypeStatusId : existing.FromTransactionTypeStatusId,
      data.ToTransactionTypeStatusId !== undefined ? data.ToTransactionTypeStatusId : existing.ToTransactionTypeStatusId,
      data.Tag !== undefined ? (data.Tag || null) : existing.Tag,
      data.Active !== undefined ? data.Active : existing.Active,
      userPhone,
      id,
      tenantId,
    ];
  }
}

const service = new TransactionTypeBaseConversionService();
module.exports = {
  getAll: (tenantId, page, limit, expand) =>
    service.getAll(tenantId, page, limit, expand),
  getById: (id, tenantId, expand) => service.getById(id, tenantId, expand),
  create: (data, tenantId, userPhone) =>
    service.create(data, tenantId, userPhone),
  update: (id, data, tenantId, userPhone) =>
    service.update(id, data, tenantId, userPhone),
  delete: (id, tenantId) => service.delete(id, tenantId),
};
