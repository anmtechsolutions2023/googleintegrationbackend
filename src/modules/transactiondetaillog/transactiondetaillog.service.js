// src/modules/transactiondetaillog/transactiondetaillog.service.js
const BaseCRUDService = require('../../common/BaseCRUDService');
const { QUERIES } = require('../../config/constants');

class TransactionDetailLogService extends BaseCRUDService {
  constructor() {
    super('Transaction Detail Log', QUERIES.TRANSACTION_DETAIL_LOG);
  }

  prepareInsertParams(id, data, tenantId, userEmail) {
    return [
      id,
      tenantId,
      data.TransactionNo,
      data.TransactionTypeConfigId,
      data.TransactionTypeStatusId || null,
      data.BranchId || null,
      data.TransactionDate || null,
      data.Remarks || null,
      data.Active !== undefined ? data.Active : true,
      userEmail,
      userEmail,
    ];
  }

  prepareUpdateParams(data, existing, userEmail, id, tenantId) {
    return [
      data.TransactionNo !== undefined
        ? data.TransactionNo
        : existing.TransactionNo,
      data.TransactionTypeConfigId !== undefined
        ? data.TransactionTypeConfigId
        : existing.TransactionTypeConfigId,
      data.TransactionTypeStatusId !== undefined
        ? data.TransactionTypeStatusId
        : existing.TransactionTypeStatusId,
      data.BranchId !== undefined ? data.BranchId : existing.BranchId,
      data.TransactionDate !== undefined
        ? data.TransactionDate
        : existing.TransactionDate,
      data.Remarks !== undefined ? data.Remarks : existing.Remarks,
      data.Active !== undefined ? data.Active : existing.Active,
      userEmail,
      id,
      tenantId,
    ];
  }
}

const service = new TransactionDetailLogService();
module.exports = {
  getAll: (tenantId, page, limit, expand) =>
    service.getAll(tenantId, page, limit, expand),
  getById: (id, tenantId, expand) => service.getById(id, tenantId, expand),
  create: (data, tenantId, userEmail) =>
    service.create(data, tenantId, userEmail),
  update: (id, data, tenantId, userEmail) =>
    service.update(id, data, tenantId, userEmail),
  delete: (id, tenantId) => service.delete(id, tenantId),
};
