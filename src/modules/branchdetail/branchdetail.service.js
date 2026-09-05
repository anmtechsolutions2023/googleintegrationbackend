// src/modules/branchdetail/branchdetail.service.js
const BaseCRUDService = require('../../common/BaseCRUDService')
const { QUERIES } = require('../../config/constants')

class BranchDetailService extends BaseCRUDService {
  constructor() {
    super('Branch Detail', QUERIES.BRANCH_DETAIL)
  }

  prepareInsertParams(id, data, tenantId, userPhone) {
    return [
      id,
      tenantId,
      data.OrganizationDetailId || data.OrganizationId || null,
      data.ContactDetailId || null,
      data.AddressDetailId || null,
      data.TransactionTypeConfigId || null,
      data.BranchName || data.Name || null,
      data.TINNo || null,
      data.GSTIN || null,
      data.PAN || null,
      data.CF1 || null,
      data.CF2 || null,
      data.CF3 || null,
      data.CF4 || null,
      data.Active !== undefined ? data.Active : true,
      userPhone,
      userPhone,
    ]
  }

  prepareUpdateParams(data, existing, userPhone, id, tenantId) {
    return [
      data.OrganizationDetailId !== undefined
        ? data.OrganizationDetailId
        : existing.OrganizationDetailId,
      data.ContactDetailId !== undefined
        ? data.ContactDetailId
        : existing.ContactDetailId,
      data.AddressDetailId !== undefined
        ? data.AddressDetailId
        : existing.AddressDetailId,
      data.TransactionTypeConfigId || existing.TransactionTypeConfigId,
      data.BranchName || data.Name || existing.BranchName || existing.Name,
      data.TINNo !== undefined ? data.TINNo : existing.TINNo,
      data.GSTIN !== undefined ? data.GSTIN : existing.GSTIN,
      data.PAN !== undefined ? data.PAN : existing.PAN,
      data.CF1 !== undefined ? data.CF1 : existing.CF1,
      data.CF2 !== undefined ? data.CF2 : existing.CF2,
      data.CF3 !== undefined ? data.CF3 : existing.CF3,
      data.CF4 !== undefined ? data.CF4 : existing.CF4,
      data.Active !== undefined ? data.Active : existing.Active,
      userPhone,
      id,
      tenantId,
    ]
  }
}

const service = new BranchDetailService()
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
}
