// src/modules/taxgrouptaxtypemapper/taxgrouptaxtypemapper.service.js
const BaseCRUDService = require('../../common/BaseCRUDService');
const { QUERIES } = require('../../config/constants');

class TaxGroupTaxTypeMapperService extends BaseCRUDService {
  constructor() {
    super('Tax Group Tax Type Mapper', QUERIES.TAX_GROUP_TAX_TYPE_MAPPER);
  }

  prepareInsertParams(id, data, tenantId, userEmail) {
    return [
      id,
      tenantId,
      data.TaxGroupId,
      data.TaxTypeId,
      data.Active !== undefined ? data.Active : true,
      userEmail,
      userEmail,
    ];
  }

  prepareUpdateParams(data, existing, userEmail, id, tenantId) {
    return [
      data.TaxGroupId !== undefined ? data.TaxGroupId : existing.TaxGroupId,
      data.TaxTypeId !== undefined ? data.TaxTypeId : existing.TaxTypeId,
      data.Active !== undefined ? data.Active : existing.Active,
      userEmail,
      id,
      tenantId,
    ];
  }
}

const service = new TaxGroupTaxTypeMapperService();
module.exports = {
  // Exposed for the bulk import — see taxtype.service.js.
  createTx: (conn, data, tenantId, userEmail) =>
    service.createTx(conn, data, tenantId, userEmail),
  getAll: (tenantId, page, limit, expand) => service.getAll(tenantId, page, limit, expand),
  getById: (id, tenantId, expand) => service.getById(id, tenantId, expand),
  create: (data, tenantId, userEmail) =>
    service.create(data, tenantId, userEmail),
  update: (id, data, tenantId, userEmail) =>
    service.update(id, data, tenantId, userEmail),
  delete: (id, tenantId) => service.delete(id, tenantId),
};
