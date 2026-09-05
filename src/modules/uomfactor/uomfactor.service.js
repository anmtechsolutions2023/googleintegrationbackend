// src/modules/uomfactor/uomfactor.service.js
const BaseCRUDService = require('../../common/BaseCRUDService');
const { QUERIES } = require('../../config/constants');
const { logger } = require('../../utils/logger');

class UomFactorService extends BaseCRUDService {
  constructor() {
    super('UOM Factor', QUERIES.UOM_FACTOR);
  }

  prepareInsertParams(id, data, tenantId, userPhone) {
    return [
      id,
      tenantId,
      data.PrimaryUOMId,
      data.SecondaryUOMId,
      data.Factor,
      data.Active !== undefined ? data.Active : true,
      userPhone,
      userPhone,
    ];
  }

  prepareUpdateParams(data, existing, userPhone, id, tenantId) {
    return [
      data.PrimaryUOMId !== undefined
        ? data.PrimaryUOMId
        : existing.PrimaryUOMId,
      data.SecondaryUOMId !== undefined
        ? data.SecondaryUOMId
        : existing.SecondaryUOMId,
      data.Factor !== undefined ? data.Factor : existing.Factor,
      data.Active !== undefined ? data.Active : existing.Active,
      userPhone,
      id,
      tenantId,
    ];
  }
}

const service = new UomFactorService();
module.exports = {
  getAll: (tenantId, page, limit, expand) =>
    service.getAll(tenantId, page, limit, expand),
  getById: (id, tenantId, expand) => service.getById(id, tenantId, expand),
  create: (data, tenantId, userPhone) =>
    service.create(data, tenantId, userPhone),
  update: (id, data, tenantId, userPhone) =>
    service.update(id, data, tenantId, userPhone),
  delete: (id, tenantId) => service.delete(id, tenantId),
};
