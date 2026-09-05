// src/modules/posfeedback/posfeedback.service.js
// POS Feedback service — business logic extending BaseCRUDService (SRP + DIP).

const BaseCRUDService = require('../../common/BaseCRUDService');
const { QUERIES } = require('../../config/constants');

class PosFeedbackService extends BaseCRUDService {
  constructor() {
    super('POS Feedback', QUERIES.POS_FEEDBACK);
  }

  prepareInsertParams(id, data, tenantId, userPhone) {
    return [
      id,
      tenantId,
      data.CustomerId ?? null,
      data.CustomerName ?? null,
      data.Rating ?? null,
      data.Comments ?? null,
      data.OrderId ?? null,
      data.BranchDetailId ?? null,
      data.Active !== undefined ? data.Active : true,
      userPhone,
      userPhone,
    ];
  }

  prepareUpdateParams(data, existing, userPhone, id, tenantId) {
    return [
      data.CustomerId !== undefined ? data.CustomerId : existing.CustomerId,
      data.CustomerName !== undefined ? data.CustomerName : existing.CustomerName,
      data.Rating !== undefined ? data.Rating : existing.Rating,
      data.Comments !== undefined ? data.Comments : existing.Comments,
      data.OrderId !== undefined ? data.OrderId : existing.OrderId,
      data.BranchDetailId !== undefined ? data.BranchDetailId : existing.BranchDetailId,
      data.Active !== undefined ? data.Active : existing.Active,
      userPhone,
      id,
      tenantId,
    ];
  }
}

const service = new PosFeedbackService();

module.exports = {
  getAll: (tenantId, page, limit) => service.getAll(tenantId, page, limit),
  getById: (id, tenantId) => service.getById(id, tenantId),
  create: (data, tenantId, userPhone) => service.create(data, tenantId, userPhone),
  update: (id, data, tenantId, userPhone) => service.update(id, data, tenantId, userPhone),
  remove: (id, tenantId) => service.delete(id, tenantId),
};
