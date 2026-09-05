// src/modules/posfoodtype/posfoodtype.service.js
// POS Food Type master service — business logic extending BaseCRUDService.
// Replaces the previously hardcoded veg/nonveg/vegan list with a CRUD-managed
// master. IsVeg drives the veg/non-veg badge shown on the Billing menu grid.

const BaseCRUDService = require('../../common/BaseCRUDService');
const { QUERIES } = require('../../config/constants');

class PosFoodTypeService extends BaseCRUDService {
  constructor() {
    super('POS Food Type', QUERIES.POS_FOOD_TYPE);
  }

  prepareInsertParams(id, data, tenantId, userPhone) {
    return [
      id,
      tenantId,
      data.Name ?? null,
      data.Code ?? null,
      data.Description ?? null,
      data.SortOrder !== undefined ? data.SortOrder : 0,
      data.IsVeg !== undefined ? data.IsVeg : false,
      data.Active !== undefined ? data.Active : true,
      userPhone,
      userPhone,
    ];
  }

  prepareUpdateParams(data, existing, userPhone, id, tenantId) {
    return [
      data.Name !== undefined ? data.Name : existing.Name,
      data.Code !== undefined ? data.Code : existing.Code,
      data.Description !== undefined ? data.Description : existing.Description,
      data.SortOrder !== undefined ? data.SortOrder : existing.SortOrder,
      data.IsVeg !== undefined ? data.IsVeg : existing.IsVeg,
      data.Active !== undefined ? data.Active : existing.Active,
      userPhone,
      id,
      tenantId,
    ];
  }
}

const service = new PosFoodTypeService();

module.exports = {
  getAll: (tenantId, page, limit) => service.getAll(tenantId, page, limit),
  getById: (id, tenantId) => service.getById(id, tenantId),
  create: (data, tenantId, userPhone) => service.create(data, tenantId, userPhone),
  update: (id, data, tenantId, userPhone) => service.update(id, data, tenantId, userPhone),
  remove: (id, tenantId) => service.delete(id, tenantId),
};
