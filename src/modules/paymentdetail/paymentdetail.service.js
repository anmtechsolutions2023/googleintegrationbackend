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
      data.PaymentReceivedTypeId,
      data.TransactionDetailLogId,
      data.Amount,
      data.PaymentDate || null,
      data.ReferenceNo || null,
      data.Remarks || null,
      data.Active !== undefined ? data.Active : true,
      userEmail,
      userEmail,
    ];
  }

  prepareUpdateParams(data, existing, userEmail, id, tenantId) {
    return [
      data.PaymentReceivedTypeId !== undefined
        ? data.PaymentReceivedTypeId
        : existing.PaymentReceivedTypeId,
      data.TransactionDetailLogId !== undefined
        ? data.TransactionDetailLogId
        : existing.TransactionDetailLogId,
      data.Amount !== undefined ? data.Amount : existing.Amount,
      data.PaymentDate !== undefined ? data.PaymentDate : existing.PaymentDate,
      data.ReferenceNo !== undefined ? data.ReferenceNo : existing.ReferenceNo,
      data.Remarks !== undefined ? data.Remarks : existing.Remarks,
      data.Active !== undefined ? data.Active : existing.Active,
      userEmail,
      id,
      tenantId,
    ];
  }
}

const service = new PaymentDetailService();
module.exports = {
  getAll: (tenantId, page, limit) => service.getAll(tenantId, page, limit),
  getById: (id, tenantId) => service.getById(id, tenantId),
  create: (data, tenantId, userEmail) =>
    service.create(data, tenantId, userEmail),
  update: (id, data, tenantId, userEmail) =>
    service.update(id, data, tenantId, userEmail),
  delete: (id, tenantId) => service.delete(id, tenantId),
};
