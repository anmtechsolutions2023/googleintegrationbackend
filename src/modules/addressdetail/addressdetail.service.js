// src/modules/addressdetail/addressdetail.service.js
const BaseCRUDService = require('../../common/BaseCRUDService');
const { QUERIES } = require('../../config/constants');

class AddressDetailService extends BaseCRUDService {
  constructor() {
    super('Address Detail', QUERIES.ADDRESS_DETAIL);
  }

  prepareInsertParams(id, data, tenantId, userPhone) {
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
      userPhone,
      userPhone,
    ];
  }

  prepareUpdateParams(data, existing, userPhone, id, tenantId) {
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
      userPhone,
      id,
      tenantId,
    ];
  }
}

const service = new AddressDetailService();
module.exports = {
  createTx: (conn, data, tenantId, userPhone) => service.createTx(conn, data, tenantId, userPhone),
  getAll: (tenantId, page, limit, expand) =>
    service.getAll(tenantId, page, limit, expand),
  getById: (id, tenantId, expand) => service.getById(id, tenantId, expand),
  create: (data, tenantId, userPhone) =>
    service.create(data, tenantId, userPhone),
  update: (id, data, tenantId, userPhone) =>
    service.update(id, data, tenantId, userPhone),
  delete: (id, tenantId) => service.delete(id, tenantId),
};
