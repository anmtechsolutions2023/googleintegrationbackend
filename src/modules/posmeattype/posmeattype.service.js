// src/modules/posmeattype/posmeattype.service.js
// POS Meat Type master service — business logic extending BaseCRUDService.
//
// Meat type is ORTHOGONAL to food type, not a refinement of it: a dish is
// Non-Veg (pos_food_type) AND Chicken (this). Aggregators filter on the second,
// and a diner avoiding pork is filtering on nothing else — 'Non-Veg' alone
// cannot answer them, which is why this is its own master rather than more rows
// in pos_food_type.

const BaseCRUDService = require('../../common/BaseCRUDService');
const { QUERIES } = require('../../config/constants');

class PosMeatTypeService extends BaseCRUDService {
  constructor() {
    super('POS Meat Type', QUERIES.POS_MEAT_TYPE);
  }

  prepareInsertParams(id, data, tenantId, userPhone) {
    return [
      id,
      tenantId,
      data.Name ?? null,
      data.Code ?? null,
      data.Description ?? null,
      data.SortOrder !== undefined ? data.SortOrder : 0,
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
      data.Active !== undefined ? data.Active : existing.Active,
      userPhone,
      id,
      tenantId,
    ];
  }
}

const service = new PosMeatTypeService();

module.exports = {
  getAll: (tenantId, page, limit) => service.getAll(tenantId, page, limit),
  getById: (id, tenantId) => service.getById(id, tenantId),
  create: (data, tenantId, userPhone) => service.create(data, tenantId, userPhone),
  update: (id, data, tenantId, userPhone) => service.update(id, data, tenantId, userPhone),
  remove: (id, tenantId) => service.delete(id, tenantId),
};
