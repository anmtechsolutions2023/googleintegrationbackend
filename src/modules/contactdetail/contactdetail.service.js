// src/modules/contactdetail/contactdetail.service.js
const BaseCRUDService = require('../../common/BaseCRUDService');
const { QUERIES } = require('../../config/constants');

class ContactDetailService extends BaseCRUDService {
  constructor() {
    super('Contact Detail', QUERIES.CONTACT_DETAIL);
  }

  prepareInsertParams(id, data, tenantId, userPhone) {
    return [
      id,
      tenantId,
      data.FirstName,
      data.LastName || null,
      data.MobileNo || null,
      data.AltMobileNo || null,
      data.Landline1 || null,
      data.LandLine2 || null,
      data.Ext1 || null,
      data.Ext2 || null,
      data.ContactAddressTypeId || null,
      data.Active !== undefined ? data.Active : true,
      userPhone,
      userPhone,
    ];
  }

  prepareUpdateParams(data, existing, userPhone, id, tenantId) {
    return [
      data.FirstName !== undefined ? data.FirstName : existing.FirstName,
      data.LastName !== undefined ? data.LastName : existing.LastName,
      data.MobileNo !== undefined ? data.MobileNo : existing.MobileNo,
      data.AltMobileNo !== undefined ? data.AltMobileNo : existing.AltMobileNo,
      data.Landline1 !== undefined ? data.Landline1 : existing.Landline1,
      // DB column is LandLine2 (after migration rename from Landline2)
      data.LandLine2 !== undefined ? data.LandLine2 : existing.LandLine2,
      data.Ext1 !== undefined ? data.Ext1 : existing.Ext1,
      data.Ext2 !== undefined ? data.Ext2 : existing.Ext2,
      data.ContactAddressTypeId !== undefined
        ? data.ContactAddressTypeId
        : existing.ContactAddressTypeId,
      data.Active !== undefined ? data.Active : existing.Active,
      userPhone,
      id,
      tenantId,
    ];
  }
}

const service = new ContactDetailService();
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
