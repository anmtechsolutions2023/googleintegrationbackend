// src/modules/paymentmodetransactiondetail/paymentmodetransactiondetail.service.js
const BaseCRUDService = require('../../common/BaseCRUDService');
const { QUERIES } = require('../../config/constants');

class PaymentModeTransactionDetailService extends BaseCRUDService {
  constructor() {
    super(
      'Payment Mode Transaction Detail',
      QUERIES.PAYMENT_MODE_TRANSACTION_DETAIL
    );
  }

  prepareInsertParams(id, data, tenantId, userEmail) {
    return [
      id,
      tenantId,
      data.PaymentModeId,
      data.TransactionDetailLogId,
      data.Amount,
      data.ReferenceNo || null,
      data.Active !== undefined ? data.Active : true,
      userEmail,
      userEmail,
    ];
  }

  prepareUpdateParams(data, existing, userEmail, id, tenantId) {
    return [
      data.PaymentModeId !== undefined
        ? data.PaymentModeId
        : existing.PaymentModeId,
      data.TransactionDetailLogId !== undefined
        ? data.TransactionDetailLogId
        : existing.TransactionDetailLogId,
      data.Amount !== undefined ? data.Amount : existing.Amount,
      data.ReferenceNo !== undefined ? data.ReferenceNo : existing.ReferenceNo,
      data.Active !== undefined ? data.Active : existing.Active,
      userEmail,
      id,
      tenantId,
    ];
  }
}

const service = new PaymentModeTransactionDetailService();
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
