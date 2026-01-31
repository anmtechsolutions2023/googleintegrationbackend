// src/modules/transactiontypeconversionmapper/transactiontypeconversionmapper.service.js
const BaseCRUDService = require('../../common/BaseCRUDService');
const { QUERIES } = require('../../config/constants');

class TransactionTypeConversionMapperService extends BaseCRUDService {
  constructor() {
    super(
      'Transaction Type Conversion Mapper',
      QUERIES.TRANSACTION_TYPE_CONVERSION_MAPPER
    );
  }

  prepareInsertParams(id, data, tenantId, userEmail) {
    return [
      id,
      tenantId,
      data.TransactionTypeBaseConversionId,
      data.FromTransactionDetailLogId,
      data.ToTransactionDetailLogId,
      data.Active !== undefined ? data.Active : true,
      userEmail,
      userEmail,
    ];
  }

  prepareUpdateParams(data, existing, userEmail, id, tenantId) {
    return [
      data.TransactionTypeBaseConversionId !== undefined
        ? data.TransactionTypeBaseConversionId
        : existing.TransactionTypeBaseConversionId,
      data.FromTransactionDetailLogId !== undefined
        ? data.FromTransactionDetailLogId
        : existing.FromTransactionDetailLogId,
      data.ToTransactionDetailLogId !== undefined
        ? data.ToTransactionDetailLogId
        : existing.ToTransactionDetailLogId,
      data.Active !== undefined ? data.Active : existing.Active,
      userEmail,
      id,
      tenantId,
    ];
  }
}

const service = new TransactionTypeConversionMapperService();
module.exports = {
  getAll: (tenantId, page, limit) => service.getAll(tenantId, page, limit),
  getById: (id, tenantId) => service.getById(id, tenantId),
  create: (data, tenantId, userEmail) =>
    service.create(data, tenantId, userEmail),
  update: (id, data, tenantId, userEmail) =>
    service.update(id, data, tenantId, userEmail),
  delete: (id, tenantId) => service.delete(id, tenantId),
};
