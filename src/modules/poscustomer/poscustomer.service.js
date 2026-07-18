// src/modules/poscustomer/poscustomer.service.js
// POS Customer service — business logic extending BaseCRUDService (SRP + DIP).

const BaseCRUDService = require('../../common/BaseCRUDService');
const { QUERIES } = require('../../config/constants');

class PosCustomerService extends BaseCRUDService {
  constructor() {
    super('POS Customer', QUERIES.POS_CUSTOMER);
  }

  prepareInsertParams(id, data, tenantId, userEmail) {
    return [
      id,
      tenantId,
      data.Name ?? null,
      data.Phone ?? null,
      data.Email ?? null,
      data.Visits !== undefined ? data.Visits : 0,
      data.TotalSpent !== undefined ? data.TotalSpent : 0,
      data.LoyaltyPoints !== undefined ? data.LoyaltyPoints : 0,
      data.BranchDetailId ?? null,
      data.Active !== undefined ? data.Active : true,
      userEmail,
      userEmail,
    ];
  }

  prepareUpdateParams(data, existing, userEmail, id, tenantId) {
    return [
      data.Name !== undefined ? data.Name : existing.Name,
      data.Phone !== undefined ? data.Phone : existing.Phone,
      data.Email !== undefined ? data.Email : existing.Email,
      data.Visits !== undefined ? data.Visits : existing.Visits,
      data.TotalSpent !== undefined ? data.TotalSpent : existing.TotalSpent,
      data.LoyaltyPoints !== undefined ? data.LoyaltyPoints : existing.LoyaltyPoints,
      data.BranchDetailId !== undefined ? data.BranchDetailId : existing.BranchDetailId,
      data.Active !== undefined ? data.Active : existing.Active,
      userEmail,
      id,
      tenantId,
    ];
  }
}

const service = new PosCustomerService();

module.exports = {
  getAll: (tenantId, page, limit) => service.getAll(tenantId, page, limit),
  getById: (id, tenantId) => service.getById(id, tenantId),
  create: (data, tenantId, userEmail) => service.create(data, tenantId, userEmail),
  update: (id, data, tenantId, userEmail) => service.update(id, data, tenantId, userEmail),
  remove: (id, tenantId) => service.delete(id, tenantId),
};
