// src/modules/costinfo/costinfo.service.js
const BaseCRUDService = require('../../common/BaseCRUDService');
const { QUERIES } = require('../../config/constants');

class CostInfoService extends BaseCRUDService {
  constructor() {
    super('Cost Info', QUERIES.COST_INFO);
  }

  prepareInsertParams(id, data, tenantId, userEmail) {
    return [
      id,
      tenantId,
      data.Amount,
      data.TaxGroupId || null,
      data.IsTaxIncluded !== undefined ? data.IsTaxIncluded : false,
      data.Active !== undefined ? data.Active : true,
      userEmail,
      userEmail,
    ];
  }

  prepareUpdateParams(data, existing, userEmail, id, tenantId) {
    return [
      data.Amount !== undefined ? data.Amount : existing.Amount,
      data.TaxGroupId !== undefined ? data.TaxGroupId : existing.TaxGroupId,
      data.IsTaxIncluded !== undefined
        ? data.IsTaxIncluded
        : existing.IsTaxIncluded,
      data.Active !== undefined ? data.Active : existing.Active,
      userEmail,
      id,
      tenantId,
    ];
  }
}

const service = new CostInfoService();
module.exports = {
  getAll: (tenantId, page, limit) => service.getAll(tenantId, page, limit),
  getById: (id, tenantId) => service.getById(id, tenantId),
  create: (data, tenantId, userEmail) =>
    service.create(data, tenantId, userEmail),
  update: (id, data, tenantId, userEmail) =>
    service.update(id, data, tenantId, userEmail),
  delete: (id, tenantId) => service.delete(id, tenantId),
};
