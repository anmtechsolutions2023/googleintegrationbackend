// src/modules/posstaff/posstaff.service.js
// POS Staff service — business logic extending BaseCRUDService (SRP + DIP).

const BaseCRUDService = require('../../common/BaseCRUDService');
const { QUERIES } = require('../../config/constants');

class PosStaffService extends BaseCRUDService {
  constructor() {
    super('POS Staff', QUERIES.POS_STAFF);
  }

  prepareInsertParams(id, data, tenantId, userEmail) {
    return [
      id,
      tenantId,
      data.Name ?? null,
      data.Role ?? null,
      data.Phone ?? null,
      data.Email ?? null,
      data.BranchDetailId ?? null,
      data.Active !== undefined ? data.Active : true,
      userEmail,
      userEmail,
    ];
  }

  prepareUpdateParams(data, existing, userEmail, id, tenantId) {
    return [
      data.Name !== undefined ? data.Name : existing.Name,
      data.Role !== undefined ? data.Role : existing.Role,
      data.Phone !== undefined ? data.Phone : existing.Phone,
      data.Email !== undefined ? data.Email : existing.Email,
      data.BranchDetailId !== undefined ? data.BranchDetailId : existing.BranchDetailId,
      data.Active !== undefined ? data.Active : existing.Active,
      userEmail,
      id,
      tenantId,
    ];
  }
}

const service = new PosStaffService();

module.exports = {
  getAll: (tenantId, page, limit) => service.getAll(tenantId, page, limit),
  getById: (id, tenantId) => service.getById(id, tenantId),
  create: (data, tenantId, userEmail) => service.create(data, tenantId, userEmail),
  update: (id, data, tenantId, userEmail) => service.update(id, data, tenantId, userEmail),
  remove: (id, tenantId) => service.delete(id, tenantId),
};
