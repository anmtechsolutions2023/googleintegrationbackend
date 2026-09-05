// src/modules/accounttypebase/accounttypebase.service.js
const BaseCRUDService = require('../../common/BaseCRUDService');
const { QUERIES } = require('../../config/constants');
const { logger } = require('../../utils/logger');

class AccountTypeBaseService extends BaseCRUDService {
  constructor() {
    super('Account Type Base', QUERIES.ACCOUNT_TYPE_BASE);
  }

  prepareInsertParams(id, data, tenantId, userPhone) {
    return [
      id,
      tenantId,
      data.Name,
      data.Active !== undefined ? data.Active : true,
      userPhone,
      userPhone,
    ];
  }

  prepareUpdateParams(data, existing, userPhone, id, tenantId) {
    return [
      data.Name !== undefined ? data.Name : existing.Name,
      data.Active !== undefined ? data.Active : existing.Active,
      userPhone,
      id,
      tenantId,
    ];
  }
}

const service = new AccountTypeBaseService();
module.exports = {
  getAll: (tenantId, page, limit) => service.getAll(tenantId, page, limit),
  getById: (id, tenantId) => service.getById(id, tenantId),
  create: (data, tenantId, userPhone) =>
    service.create(data, tenantId, userPhone),
  update: (id, data, tenantId, userPhone) =>
    service.update(id, data, tenantId, userPhone),
  delete: (id, tenantId) => service.delete(id, tenantId),
};
