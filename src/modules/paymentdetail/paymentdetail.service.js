// src/modules/paymentdetail/paymentdetail.service.js
const BaseCRUDService = require('../../common/BaseCRUDService');
const { QUERIES } = require('../../config/constants');

class PaymentDetailService extends BaseCRUDService {
  constructor() {
    super('Payment Detail', QUERIES.PAYMENT_DETAIL);
  }

  prepareInsertParams(id, data, tenantId, userEmail) {
    return [
      id,
      tenantId,
      data.AccountTypeBaseId,
      data.TransactionDetailLogId,
      data.DiscountAmount || null,
      data.RoundOff || null,
      data.TotalAmount,
      data.TaxesAmount || null,
      data.GrossAmount,
      data.UserId || null,
      data.Active !== undefined ? data.Active : true,
      userEmail,
      userEmail,
    ];
  }

  prepareUpdateParams(data, existing, userEmail, id, tenantId) {
    return [
      data.AccountTypeBaseId !== undefined ? data.AccountTypeBaseId : existing.AccountTypeBaseId,
      data.TransactionDetailLogId !== undefined ? data.TransactionDetailLogId : existing.TransactionDetailLogId,
      data.DiscountAmount !== undefined ? data.DiscountAmount : existing.DiscountAmount,
      data.RoundOff !== undefined ? data.RoundOff : existing.RoundOff,
      data.TotalAmount !== undefined ? data.TotalAmount : existing.TotalAmount,
      data.TaxesAmount !== undefined ? data.TaxesAmount : existing.TaxesAmount,
      data.GrossAmount !== undefined ? data.GrossAmount : existing.GrossAmount,
      data.UserId !== undefined ? data.UserId : existing.UserId,
      data.Active !== undefined ? data.Active : existing.Active,
      userEmail,
      id,
      tenantId,
    ];
  }
}

const service = new PaymentDetailService();
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
