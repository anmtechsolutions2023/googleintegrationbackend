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
      data.ItemDetailId,
      data.BatchDetailId || null,
      data.Quantity,
      data.UOMId || null,
      data.Rate || null,
      data.Amount || null,
      data.TaxGroupId || null,
      data.TaxAmount || null,
      data.DiscountAmount || null,
      data.NetAmount || null,
      data.Active !== undefined ? data.Active : true,
      userEmail,
      userEmail,
    ];
  }

  prepareUpdateParams(data, existing, userEmail, id, tenantId) {
    return [
      data.TransactionDetailLogId !== undefined
        ? data.TransactionDetailLogId
        : existing.TransactionDetailLogId,
      data.ItemDetailId !== undefined
        ? data.ItemDetailId
        : existing.ItemDetailId,
      data.BatchDetailId !== undefined
        ? data.BatchDetailId
        : existing.BatchDetailId,
      data.Quantity !== undefined ? data.Quantity : existing.Quantity,
      data.UOMId !== undefined ? data.UOMId : existing.UOMId,
      data.Rate !== undefined ? data.Rate : existing.Rate,
      data.Amount !== undefined ? data.Amount : existing.Amount,
      data.TaxGroupId !== undefined ? data.TaxGroupId : existing.TaxGroupId,
      data.TaxAmount !== undefined ? data.TaxAmount : existing.TaxAmount,
      data.DiscountAmount !== undefined
        ? data.DiscountAmount
        : existing.DiscountAmount,
      data.NetAmount !== undefined ? data.NetAmount : existing.NetAmount,
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
