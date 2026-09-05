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

  prepareInsertParams(id, data, tenantId, userPhone) {
    return [
      id,
      tenantId,
      data.TransactionTypeBaseCoversionId,
      data.TransactionDetailLogId,
      data.TransactionTypeStatusId,
      data.Active !== undefined ? data.Active : true,
      userPhone,
      userPhone,
    ];
  }

  prepareUpdateParams(data, existing, userPhone, id, tenantId) {
    return [
      data.TransactionTypeBaseCoversionId !== undefined ? data.TransactionTypeBaseCoversionId : existing.TransactionTypeBaseCoversionId,
      data.TransactionDetailLogId !== undefined ? data.TransactionDetailLogId : existing.TransactionDetailLogId,
      data.TransactionTypeStatusId !== undefined ? data.TransactionTypeStatusId : existing.TransactionTypeStatusId,
      data.Active !== undefined ? data.Active : existing.Active,
      userPhone,
      id,
      tenantId,
    ];
  }
}

const service = new TransactionTypeConversionMapperService();
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
