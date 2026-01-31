// src/modules/mapproviderlocationmapper/mapproviderlocationmapper.service.js
const BaseCRUDService = require('../../common/BaseCRUDService');
const { QUERIES } = require('../../config/constants');

class MapProviderLocationMapperService extends BaseCRUDService {
  constructor() {
    super('Map Provider Location Mapper', QUERIES.MAP_PROVIDER_LOCATION_MAPPER);
  }

  prepareInsertParams(id, data, tenantId, userEmail) {
    return [
      id,
      tenantId,
      data.MapProviderId,
      data.LocationDetailId,
      data.Active !== undefined ? data.Active : true,
      userEmail,
      userEmail,
    ];
  }

  prepareUpdateParams(data, existing, userEmail, id, tenantId) {
    return [
      data.MapProviderId !== undefined
        ? data.MapProviderId
        : existing.MapProviderId,
      data.LocationDetailId !== undefined
        ? data.LocationDetailId
        : existing.LocationDetailId,
      data.Active !== undefined ? data.Active : existing.Active,
      userEmail,
      id,
      tenantId,
    ];
  }
}

const service = new MapProviderLocationMapperService();
module.exports = {
  getAll: (tenantId, page, limit) => service.getAll(tenantId, page, limit),
  getById: (id, tenantId) => service.getById(id, tenantId),
  create: (data, tenantId, userEmail) =>
    service.create(data, tenantId, userEmail),
  update: (id, data, tenantId, userEmail) =>
    service.update(id, data, tenantId, userEmail),
  delete: (id, tenantId) => service.delete(id, tenantId),
};
