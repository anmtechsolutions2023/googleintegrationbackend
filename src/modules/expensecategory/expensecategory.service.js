// src/modules/expensecategory/expensecategory.service.js
// Expense category master.
//
// This exists so expense reporting can group by an id rather than by whatever
// spelling was typed. As free text, "Gas", "gas" and "LPG" were three
// categories and no spend report could be trusted.

const BaseCRUDService = require('../../common/BaseCRUDService');
const { QUERIES } = require('../../config/constants');

class ExpenseCategoryService extends BaseCRUDService {
  constructor() {
    super('Expense Category', QUERIES.EXPENSE_CATEGORY);
  }

  prepareInsertParams(id, data, tenantId, userPhone) {
    return [
      id,
      tenantId,
      data.Name ?? null,
      // Which EXPENSE-kind account the spend books against.
      data.AccountTypeBaseId ?? null,
      data.Active !== undefined ? data.Active : true,
      userPhone,
      userPhone,
    ];
  }

  prepareUpdateParams(data, existing, userPhone, id, tenantId) {
    return [
      data.Name !== undefined ? data.Name : existing.Name,
      data.AccountTypeBaseId !== undefined ? data.AccountTypeBaseId : existing.AccountTypeBaseId,
      data.Active !== undefined ? data.Active : existing.Active,
      userPhone,
      id,
      tenantId,
    ];
  }
}

const service = new ExpenseCategoryService();

module.exports = {
  getAll: (tenantId, page, limit) => service.getAll(tenantId, page, limit),
  getById: (id, tenantId) => service.getById(id, tenantId),
  create: (data, tenantId, userPhone) => service.create(data, tenantId, userPhone),
  update: (id, data, tenantId, userPhone) => service.update(id, data, tenantId, userPhone),
  remove: (id, tenantId) => service.delete(id, tenantId),
};
