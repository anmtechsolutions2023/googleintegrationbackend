// src/modules/taxgrouptaxtypemapper/taxgrouptaxtypemapper.service.js
const BaseCRUDService = require('../../common/BaseCRUDService');
const { QUERIES } = require('../../config/constants');

class TaxGroupTaxTypeMapperService extends BaseCRUDService {
  constructor() {
    super('Tax Group Tax Type Mapper', QUERIES.TAX_GROUP_TAX_TYPE_MAPPER);
  }

  prepareInsertParams(id, data, tenantId, userPhone) {
    return [
      id,
      tenantId,
      data.TaxGroupId,
      data.TaxTypeId,
      data.Active !== undefined ? data.Active : true,
      userPhone,
      userPhone,
    ];
  }

  prepareUpdateParams(data, existing, userPhone, id, tenantId) {
    return [
      data.TaxGroupId !== undefined ? data.TaxGroupId : existing.TaxGroupId,
      data.TaxTypeId !== undefined ? data.TaxTypeId : existing.TaxTypeId,
      data.Active !== undefined ? data.Active : existing.Active,
      userPhone,
      id,
      tenantId,
    ];
  }
}

const service = new TaxGroupTaxTypeMapperService();
module.exports = {
  // Exposed for the bulk import — see taxtype.service.js.
  createTx: (conn, data, tenantId, userPhone) =>
    service.createTx(conn, data, tenantId, userPhone),
  getAll: (tenantId, page, limit, expand) => service.getAll(tenantId, page, limit, expand),
  getById: (id, tenantId, expand) => service.getById(id, tenantId, expand),
  create: (data, tenantId, userPhone) =>
    service.create(data, tenantId, userPhone),
  update: (id, data, tenantId, userPhone) =>
    service.update(id, data, tenantId, userPhone),
  delete: (id, tenantId) => service.delete(id, tenantId),
};
