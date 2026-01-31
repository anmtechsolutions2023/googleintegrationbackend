// src/modules/branchdetail/branchdetail.service.js
const BaseCRUDService = require('../../common/BaseCRUDService');
const { QUERIES } = require('../../config/constants');

class BranchDetailService extends BaseCRUDService {
  constructor() {
    super('Branch Detail', QUERIES.BRANCH_DETAIL);
  }

  prepareInsertParams(id, data, tenantId, userEmail) {
    return [
      id,
      tenantId,
      data.Name,
      data.AddressDetailId || null,
      data.ContactDetailId || null,
      data.OrganizationId || null,
      data.Active !== undefined ? data.Active : true,
      userEmail,
      userEmail,
    ];
  }

  prepareUpdateParams(data, existing, userEmail, id, tenantId) {
    return [
      data.Name !== undefined ? data.Name : existing.Name,
      data.AddressDetailId !== undefined ? data.AddressDetailId : existing.AddressDetailId,
      data.ContactDetailId !== undefined ? data.ContactDetailId : existing.ContactDetailId,
      data.OrganizationId !== undefined ? data.OrganizationId : existing.OrganizationId,
      data.Active !== undefined ? data.Active : existing.Active,
      userEmail,
      id,
      tenantId,
    ];
  }
}

const service = new BranchDetailService();
module.exports = {
  getAll: (tenantId, page, limit) => service.getAll(tenantId, page, limit),
  getById: (id, tenantId) => service.getById(id, tenantId),
  create: (data, tenantId, userEmail) => service.create(data, tenantId, userEmail),
  update: (id, data, tenantId, userEmail) => service.update(id, data, tenantId, userEmail),
  delete: (id, tenantId) => service.delete(id, tenantId),
};
