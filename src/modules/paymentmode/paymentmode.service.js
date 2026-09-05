// src/modules/paymentmode/paymentmode.service.js
const BaseCRUDService = require('../../common/BaseCRUDService');
const { QUERIES } = require('../../config/constants');

class PaymentModeService extends BaseCRUDService {
  constructor() {
    super('Payment Mode', QUERIES.PAYMENT_MODE);
  }

  prepareInsertParams(id, data, tenantId, userPhone) {
    return [
      id,
      tenantId,
      data.Type,
      data.Active !== undefined ? data.Active : true,
      userPhone,
      userPhone,
    ];
  }

  prepareUpdateParams(data, existing, userPhone, id, tenantId) {
    return [
      data.Type !== undefined ? data.Type : existing.Type,
      data.Active !== undefined ? data.Active : existing.Active,
      userPhone,
      id,
      tenantId,
    ];
  }
}

const service = new PaymentModeService();
module.exports = {
  getAll: (tenantId, page, limit) => service.getAll(tenantId, page, limit),
  getById: (id, tenantId) => service.getById(id, tenantId),
  create: (data, tenantId, userPhone) =>
    service.create(data, tenantId, userPhone),
  update: (id, data, tenantId, userPhone) =>
    service.update(id, data, tenantId, userPhone),
  delete: (id, tenantId) => service.delete(id, tenantId),
};
