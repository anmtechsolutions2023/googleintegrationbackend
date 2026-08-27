// src/modules/posreturnreason/posreturnreason.service.js
// Why goods came back — a master, not free text.
//
// The refund reason was `Joi.string().max(100)` stashed on the reversing
// tender's comment. Twelve cashiers produce twelve spellings of "wrong item",
// so returns could not be grouped and "what are we actually refunding for?"
// went unasked.
//
// IsFault is the column that earns its place: it separates what WE got wrong
// from what the customer simply changed their mind about. Merged, the total
// says nothing anyone can act on.

const BaseCRUDService = require('../../common/BaseCRUDService');
const { QUERIES } = require('../../config/constants');

class PosReturnReasonService extends BaseCRUDService {
  constructor() {
    super('POS Return Reason', QUERIES.POS_RETURN_REASON);
  }

  prepareInsertParams(id, data, tenantId, userEmail) {
    return [
      id,
      tenantId,
      data.Name ?? null,
      data.Code ?? null,
      data.Description ?? null,
      data.IsFault !== undefined ? (data.IsFault ? 1 : 0) : 0,
      data.SortOrder !== undefined ? data.SortOrder : 0,
      data.Active !== undefined ? data.Active : true,
      userEmail,
      userEmail,
    ];
  }

  prepareUpdateParams(data, existing, userEmail, id, tenantId) {
    return [
      data.Name !== undefined ? data.Name : existing.Name,
      data.Code !== undefined ? data.Code : existing.Code,
      data.Description !== undefined ? data.Description : existing.Description,
      data.IsFault !== undefined ? (data.IsFault ? 1 : 0) : existing.IsFault,
      data.SortOrder !== undefined ? data.SortOrder : existing.SortOrder,
      data.Active !== undefined ? data.Active : existing.Active,
      userEmail,
      id,
      tenantId,
    ];
  }
}

const service = new PosReturnReasonService();

module.exports = {
  getAll: (tenantId, page, limit) => service.getAll(tenantId, page, limit),
  getById: (id, tenantId) => service.getById(id, tenantId),
  create: (data, tenantId, userEmail) => service.create(data, tenantId, userEmail),
  update: (id, data, tenantId, userEmail) => service.update(id, data, tenantId, userEmail),
  remove: (id, tenantId) => service.delete(id, tenantId),
};
