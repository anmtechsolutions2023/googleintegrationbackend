// src/modules/mapproviderlocationmapper/mapproviderlocationmapper.service.js
const BaseCRUDService = require('../../common/BaseCRUDService');
const { QUERIES } = require('../../config/constants');

class MapProviderLocationMapperService extends BaseCRUDService {
  constructor() {
    super('Map Provider Location Mapper', QUERIES.MAP_PROVIDER_LOCATION_MAPPER);
  }

  prepareInsertParams(id, data, tenantId, userPhone) {
    return [
      id,
      tenantId,
      data.MapProviderId,
      data.LocationDetailId,
      data.TagName,
      data.Active !== undefined ? data.Active : true,
      userPhone,
      userPhone,
    ];
  }

  prepareUpdateParams(data, existing, userPhone, id, tenantId) {
    return [
      data.MapProviderId !== undefined
        ? data.MapProviderId
        : existing.MapProviderId,
      data.LocationDetailId !== undefined
        ? data.LocationDetailId
        : existing.LocationDetailId,
      data.TagName !== undefined ? data.TagName : existing.TagName,
      data.Active !== undefined ? data.Active : existing.Active,
      userPhone,
      id,
      tenantId,
    ];
  }
}

const service = new MapProviderLocationMapperService();
module.exports = {
  createTx: (conn, data, tenantId, userPhone) => service.createTx(conn, data, tenantId, userPhone),
  getAll: (tenantId, page, limit, expand) => service.getAll(tenantId, page, limit, expand),
  getById: (id, tenantId, expand) => service.getById(id, tenantId, expand),
  create: (data, tenantId, userPhone) =>
    service.create(data, tenantId, userPhone),
  update: (id, data, tenantId, userPhone) =>
    service.update(id, data, tenantId, userPhone),
  delete: (id, tenantId) => service.delete(id, tenantId),
};
