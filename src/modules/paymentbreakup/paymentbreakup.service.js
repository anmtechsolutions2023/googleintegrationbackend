// src/modules/paymentbreakup/paymentbreakup.service.js
const BaseCRUDService = require('../../common/BaseCRUDService');
const { QUERIES } = require('../../config/constants');

class PaymentBreakupService extends BaseCRUDService {
  constructor() {
    super('Payment Breakup', QUERIES.PAYMENT_BREAKUP);
  }

  prepareInsertParams(id, data, tenantId, userEmail) {
    return [
      id,
      tenantId,
      data.PaymentDetailId,
      data.PaymentModeId,
      data.Amount,
      data.ReferenceNo || null,
      data.Remarks || null,
      data.Active !== undefined ? data.Active : true,
      userEmail,
      userEmail,
    ];
  }

  prepareUpdateParams(data, existing, userEmail, id, tenantId) {
    return [
      data.PaymentDetailId !== undefined
        ? data.PaymentDetailId
        : existing.PaymentDetailId,
      data.PaymentModeId !== undefined
        ? data.PaymentModeId
        : existing.PaymentModeId,
      data.Amount !== undefined ? data.Amount : existing.Amount,
      data.ReferenceNo !== undefined ? data.ReferenceNo : existing.ReferenceNo,
      data.Remarks !== undefined ? data.Remarks : existing.Remarks,
      data.Active !== undefined ? data.Active : existing.Active,
      userEmail,
      id,
      tenantId,
    ];
  }
}

const service = new PaymentBreakupService();
module.exports = {
  getAll: (tenantId, page, limit) => service.getAll(tenantId, page, limit),
  getById: (id, tenantId) => service.getById(id, tenantId),
  create: (data, tenantId, userEmail) =>
    service.create(data, tenantId, userEmail),
  update: (id, data, tenantId, userEmail) =>
    service.update(id, data, tenantId, userEmail),
  delete: (id, tenantId) => service.delete(id, tenantId),
};
