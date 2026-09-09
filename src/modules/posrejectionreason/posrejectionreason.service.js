// src/modules/posrejectionreason/posrejectionreason.service.js
// POS Rejection Reason master service — business logic extending BaseCRUDService.
//
// Why an order was refused, in a controlled vocabulary. CancelReason alone was
// free text, so "why did we reject 40 orders last week" could only be answered
// by reading 40 sentences. pos_return_reason already proves the pattern; this
// is its sibling for portal rejections, which use a DIFFERENT vocabulary — a
// return happens after the food was made, a rejection instead of making it.
//
// A row with PortalId NULL is a HOUSE reason offered on every portal. A row
// with PortalId set belongs to that portal alone, and carries the ExternalCode
// its API expects.

const BaseCRUDService = require('../../common/BaseCRUDService');
const { QUERIES } = require('../../config/constants');
const { executeQuery } = require('../../utils/dbHelper');

class PosRejectionReasonService extends BaseCRUDService {
  constructor() {
    super('POS Rejection Reason', QUERIES.POS_REJECTION_REASON);
  }

  prepareInsertParams(id, data, tenantId, userPhone) {
    return [
      id,
      tenantId,
      data.Name ?? null,
      data.Code ?? null,
      data.ExternalCode ?? null,
      data.PortalId ?? null,
      data.RequiresItems !== undefined ? data.RequiresItems : false,
      data.Description ?? null,
      data.SortOrder !== undefined ? data.SortOrder : 0,
      data.Active !== undefined ? data.Active : true,
      userPhone,
      userPhone,
    ];
  }

  prepareUpdateParams(data, existing, userPhone, id, tenantId) {
    return [
      data.Name !== undefined ? data.Name : existing.Name,
      data.Code !== undefined ? data.Code : existing.Code,
      data.ExternalCode !== undefined ? data.ExternalCode : existing.ExternalCode,
      data.PortalId !== undefined ? data.PortalId : existing.PortalId,
      data.RequiresItems !== undefined ? data.RequiresItems : existing.RequiresItems,
      data.Description !== undefined ? data.Description : existing.Description,
      data.SortOrder !== undefined ? data.SortOrder : existing.SortOrder,
      data.Active !== undefined ? data.Active : existing.Active,
      userPhone,
      id,
      tenantId,
    ];
  }

  /**
   * The reasons a reject dialog may offer for one portal: that portal's own,
   * plus every house reason.
   *
   * @param {string} portalId
   * @param {string} tenantId
   */
  async getForPortal(portalId, tenantId) {
    return executeQuery(this.queries.SELECT_FOR_PORTAL, [tenantId, portalId]);
  }
}

const service = new PosRejectionReasonService();

module.exports = {
  getAll: (tenantId, page, limit) => service.getAll(tenantId, page, limit),
  getById: (id, tenantId) => service.getById(id, tenantId),
  getForPortal: (portalId, tenantId) => service.getForPortal(portalId, tenantId),
  create: (data, tenantId, userPhone) => service.create(data, tenantId, userPhone),
  update: (id, data, tenantId, userPhone) => service.update(id, data, tenantId, userPhone),
  remove: (id, tenantId) => service.delete(id, tenantId),
};
