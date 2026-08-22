// src/modules/posfeedback/posfeedback.service.js
// POS Feedback service — business logic extending BaseCRUDService (SRP + DIP).

const BaseCRUDService = require('../../common/BaseCRUDService');
const { QUERIES } = require('../../config/constants');

class PosFeedbackService extends BaseCRUDService {
  constructor() {
    super('POS Feedback', QUERIES.POS_FEEDBACK);
  }

  prepareInsertParams(id, data, tenantId, userEmail) {
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
      userEmail,
      userEmail,
    ];
  }

  prepareUpdateParams(data, existing, userEmail, id, tenantId) {
    return [
      data.CustomerId !== undefined ? data.CustomerId : existing.CustomerId,
      data.CustomerName !== undefined ? data.CustomerName : existing.CustomerName,
      data.Rating !== undefined ? data.Rating : existing.Rating,
      data.Comments !== undefined ? data.Comments : existing.Comments,
      data.OrderId !== undefined ? data.OrderId : existing.OrderId,
      data.BranchDetailId !== undefined ? data.BranchDetailId : existing.BranchDetailId,
      data.Active !== undefined ? data.Active : existing.Active,
      userEmail,
      id,
      tenantId,
    ];
  }
}

const service = new PosFeedbackService();

module.exports = {
  getAll: (tenantId, page, limit) => service.getAll(tenantId, page, limit),
  getById: (id, tenantId) => service.getById(id, tenantId),
  create: (data, tenantId, userEmail) => service.create(data, tenantId, userEmail),
  update: (id, data, tenantId, userEmail) => service.update(id, data, tenantId, userEmail),
  remove: (id, tenantId) => service.delete(id, tenantId),
};
