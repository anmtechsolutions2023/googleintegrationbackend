// src/modules/addressdetail/addressdetail.service.js
const BaseCRUDService = require('../../common/BaseCRUDService');
const { QUERIES } = require('../../config/constants');

class AddressDetailService extends BaseCRUDService {
  constructor() {
    super('Address Detail', QUERIES.ADDRESS_DETAIL);
  }

  prepareInsertParams(id, data, tenantId, userEmail) {
    return [
      id,
      tenantId,
      data.AddressLine1,
      data.AddressLine2 || null,
      data.City || null,
      data.State || null,
      data.Pincode || null,
      data.MapProviderLocationMapperId || null,
      data.Landmark || null,
      data.ContactAddressTypeId || null,
      data.TagName,
      data.Active !== undefined ? data.Active : true,
      userEmail,
      userEmail,
    ];
  }

  prepareUpdateParams(data, existing, userEmail, id, tenantId) {
    return [
      data.AddressLine1 !== undefined
        ? data.AddressLine1
        : existing.AddressLine1,
      data.AddressLine2 !== undefined
        ? data.AddressLine2
        : existing.AddressLine2,
      data.City !== undefined ? data.City : existing.City,
      data.State !== undefined ? data.State : existing.State,
      data.Pincode !== undefined ? data.Pincode : existing.Pincode,
      data.MapProviderLocationMapperId !== undefined
        ? data.MapProviderLocationMapperId
        : existing.MapProviderLocationMapperId,
      data.Landmark !== undefined ? data.Landmark : existing.Landmark,
      data.ContactAddressTypeId !== undefined
        ? data.ContactAddressTypeId
        : existing.ContactAddressTypeId,
      data.TagName !== undefined ? data.TagName : existing.TagName,
      data.Active !== undefined ? data.Active : existing.Active,
      userEmail,
      id,
      tenantId,
    ];
  }
}

const service = new AddressDetailService();
module.exports = {
  getAll: (tenantId, page, limit, expand) =>
    service.getAll(tenantId, page, limit, expand),
  getById: (id, tenantId, expand) => service.getById(id, tenantId, expand),
  create: (data, tenantId, userEmail) =>
    service.create(data, tenantId, userEmail),
  update: (id, data, tenantId, userEmail) =>
    service.update(id, data, tenantId, userEmail),
  delete: (id, tenantId) => service.delete(id, tenantId),
};
