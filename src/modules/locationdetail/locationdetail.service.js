// src/modules/locationdetail/locationdetail.service.js
const BaseCRUDService = require('../../common/BaseCRUDService');
const { QUERIES } = require('../../config/constants');

class LocationDetailService extends BaseCRUDService {
  constructor() {
    super('Location Detail', QUERIES.LOCATION_DETAIL);
  }

  prepareInsertParams(id, data, tenantId, userPhone) {
    return [
      id,
      tenantId,
      data.Lat,
      data.Lng,
      data.CF1 || null,
      data.CF2 || null,
      data.CF3 || null,
      data.CF4 || null,
      data.Active !== undefined ? data.Active : true,
      userPhone,
      userPhone,
    ];
  }

  prepareUpdateParams(data, existing, userPhone, id, tenantId) {
    return [
      data.Lat !== undefined ? data.Lat : existing.Lat,
      data.Lng !== undefined ? data.Lng : existing.Lng,
      data.CF1 !== undefined ? data.CF1 : existing.CF1,
      data.CF2 !== undefined ? data.CF2 : existing.CF2,
      data.CF3 !== undefined ? data.CF3 : existing.CF3,
      data.CF4 !== undefined ? data.CF4 : existing.CF4,
      data.Active !== undefined ? data.Active : existing.Active,
      userPhone,
      id,
      tenantId,
    ];
  }
}

const service = new LocationDetailService();
module.exports = {
  createTx: (conn, data, tenantId, userPhone) => service.createTx(conn, data, tenantId, userPhone),
  getAll: (tenantId, page, limit) => service.getAll(tenantId, page, limit),
  getById: (id, tenantId) => service.getById(id, tenantId),
  create: (data, tenantId, userPhone) =>
    service.create(data, tenantId, userPhone),
  update: (id, data, tenantId, userPhone) =>
    service.update(id, data, tenantId, userPhone),
  delete: (id, tenantId) => service.delete(id, tenantId),
};
