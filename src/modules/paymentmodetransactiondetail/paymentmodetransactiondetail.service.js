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
      data.RefNo || null,
      data.Comment || null,
      data.CF1 || null,
      data.CF2 || null,
      data.CF3 || null,
      data.CF4 || null,
      data.Active !== undefined ? data.Active : true,
      userEmail,
      userEmail,
    ];
  }

  prepareUpdateParams(data, existing, userEmail, id, tenantId) {
    return [
      data.PaymentModeId !== undefined ? data.PaymentModeId : existing.PaymentModeId,
      data.RefNo !== undefined ? data.RefNo : existing.RefNo,
      data.Comment !== undefined ? data.Comment : existing.Comment,
      data.CF1 !== undefined ? data.CF1 : existing.CF1,
      data.CF2 !== undefined ? data.CF2 : existing.CF2,
      data.CF3 !== undefined ? data.CF3 : existing.CF3,
      data.CF4 !== undefined ? data.CF4 : existing.CF4,
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
