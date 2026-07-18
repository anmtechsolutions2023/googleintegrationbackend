// src/modules/posvariant/posvariant.service.js
// POS Variant master service — business logic extending BaseCRUDService.

const BaseCRUDService = require('../../common/BaseCRUDService');
const { QUERIES } = require('../../config/constants');

class PosVariantService extends BaseCRUDService {
  constructor() {
    super('POS Variant', QUERIES.POS_VARIANT);
  }

  prepareInsertParams(id, data, tenantId, userEmail) {
    return [
      id,
      tenantId,
      data.Name ?? null,
      data.Code ?? null,
      data.Description ?? null,
      data.SortOrder !== undefined ? data.SortOrder : 0,
      data.Price !== undefined ? data.Price : null,
      data.Active !== undefined ? data.Active : true,
      userEmail,
      userEmail,
    ];
  }

  prepareUpdateParams(data, existing, userEmail, id, tenantId) {
    return [
      data.Name !== undefined ? data.Name : existing.Name,
      data.Code !== undefined ? data.Code : existing.Code,
      data.Description !== undefined ? data.Description : existing.Description,
      data.SortOrder !== undefined ? data.SortOrder : existing.SortOrder,
      data.Price !== undefined ? data.Price : existing.Price,
      data.Active !== undefined ? data.Active : existing.Active,
      userEmail,
      id,
      tenantId,
    ];
  }
}

const service = new PosVariantService();

module.exports = {
  getAll: (tenantId, page, limit) => service.getAll(tenantId, page, limit),
  getById: (id, tenantId) => service.getById(id, tenantId),
  create: (data, tenantId, userEmail) => service.create(data, tenantId, userEmail),
  update: (id, data, tenantId, userEmail) => service.update(id, data, tenantId, userEmail),
  remove: (id, tenantId) => service.delete(id, tenantId),
};
