// src/modules/posexpense/posexpense.service.js
// POS Expense service — business logic extending BaseCRUDService (SRP + DIP).

const BaseCRUDService = require('../../common/BaseCRUDService');
const { QUERIES } = require('../../config/constants');

class PosExpenseService extends BaseCRUDService {
  constructor() {
    super('POS Expense', QUERIES.POS_EXPENSE);
  }

  prepareInsertParams(id, data, tenantId, userEmail) {
    return [
      id,
      tenantId,
      data.Category ?? null,
      data.Description ?? null,
      data.Amount ?? null,
      data.ExpenseDate ?? null,
      data.BranchDetailId ?? null,
      data.Active !== undefined ? data.Active : true,
      userEmail,
      userEmail,
    ];
  }

  prepareUpdateParams(data, existing, userEmail, id, tenantId) {
    return [
      data.Category !== undefined ? data.Category : existing.Category,
      data.Description !== undefined ? data.Description : existing.Description,
      data.Amount !== undefined ? data.Amount : existing.Amount,
      data.ExpenseDate !== undefined ? data.ExpenseDate : existing.ExpenseDate,
      data.BranchDetailId !== undefined ? data.BranchDetailId : existing.BranchDetailId,
      data.Active !== undefined ? data.Active : existing.Active,
      userEmail,
      id,
      tenantId,
    ];
  }
}

const service = new PosExpenseService();

module.exports = {
  getAll: (tenantId, page, limit) => service.getAll(tenantId, page, limit),
  getById: (id, tenantId) => service.getById(id, tenantId),
  create: (data, tenantId, userEmail) => service.create(data, tenantId, userEmail),
  update: (id, data, tenantId, userEmail) => service.update(id, data, tenantId, userEmail),
  remove: (id, tenantId) => service.delete(id, tenantId),
};
