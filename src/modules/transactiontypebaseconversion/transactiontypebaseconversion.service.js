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

  prepareInsertParams(id, data, tenantId, userEmail) {
    return [
      id,
      tenantId,
      data.TransactionTypeConfigId,
      data.FromTransactionTypeStatusId,
      data.ToTransactionTypeStatusId,
      data.Active !== undefined ? data.Active : true,
      userEmail,
      userEmail,
    ];
  }

  prepareUpdateParams(data, existing, userEmail, id, tenantId) {
    return [
      data.TransactionTypeConfigId !== undefined
        ? data.TransactionTypeConfigId
        : existing.TransactionTypeConfigId,
      data.FromTransactionTypeStatusId !== undefined
        ? data.FromTransactionTypeStatusId
        : existing.FromTransactionTypeStatusId,
      data.ToTransactionTypeStatusId !== undefined
        ? data.ToTransactionTypeStatusId
        : existing.ToTransactionTypeStatusId,
      data.Active !== undefined ? data.Active : existing.Active,
      userEmail,
      id,
      tenantId,
    ];
  }
}

const service = new TransactionTypeBaseConversionService();
module.exports = {
  getAll: (tenantId, page, limit) => service.getAll(tenantId, page, limit),
  getById: (id, tenantId) => service.getById(id, tenantId),
  create: (data, tenantId, userEmail) =>
    service.create(data, tenantId, userEmail),
  update: (id, data, tenantId, userEmail) =>
    service.update(id, data, tenantId, userEmail),
  delete: (id, tenantId) => service.delete(id, tenantId),
};
