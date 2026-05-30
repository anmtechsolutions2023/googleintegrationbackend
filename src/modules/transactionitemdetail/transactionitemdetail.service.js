// src/modules/transactionitemdetail/transactionitemdetail.service.js
const BaseCRUDService = require('../../common/BaseCRUDService');
const { QUERIES } = require('../../config/constants');

class TransactionItemDetailService extends BaseCRUDService {
  constructor() {
    super('Transaction Item Detail', QUERIES.TRANSACTION_ITEM_DETAIL);
  }

  prepareInsertParams(id, data, tenantId, userEmail) {
    return [
      id,
      tenantId,
      data.TransactionDetailLogId,
      data.ItemId,
      data.Comment || null,
      data.Active !== undefined ? data.Active : true,
      userEmail,
      userEmail,
    ];
  }

  prepareUpdateParams(data, existing, userEmail, id, tenantId) {
    return [
      data.TransactionDetailLogId !== undefined ? data.TransactionDetailLogId : existing.TransactionDetailLogId,
      data.ItemId !== undefined ? data.ItemId : existing.ItemId,
      data.Comment !== undefined ? data.Comment : existing.Comment,
      data.Active !== undefined ? data.Active : existing.Active,
      userEmail,
      id,
      tenantId,
    ];
  }
}

const service = new TransactionItemDetailService();
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
