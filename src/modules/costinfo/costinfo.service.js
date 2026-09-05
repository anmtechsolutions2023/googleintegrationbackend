// src/modules/costinfo/costinfo.service.js
const BaseCRUDService = require('../../common/BaseCRUDService');
const { QUERIES } = require('../../config/constants');
const { attachBreakdown, attachBreakdownToOne } = require('../pricing/pricing.enrich');

class CostInfoService extends BaseCRUDService {
  constructor() {
    super('Cost Info', QUERIES.COST_INFO);
  }

  // On ?expand=true, resolve the tax chain so callers see what the price is made
  // of (net / tax / gross + CGST-SGST split) instead of just a TaxGroupId.
  // The row IS the costinfo, so its own Id is the lookup key.
  async getAll(tenantId, page, limit, expand) {
    const result = await super.getAll(tenantId, page, limit, expand);
    if (!expand) return result;
    return { ...result, data: await attachBreakdown(result.data, tenantId, { idField: 'Id' }) };
  }

  async getById(id, tenantId, expand) {
    const row = await super.getById(id, tenantId, expand);
    if (!expand) return row;
    return attachBreakdownToOne(row, tenantId, { idField: 'Id' });
  }

  prepareInsertParams(id, data, tenantId, userPhone) {
    return [
      id,
      tenantId,
      data.Amount,
      data.TaxGroupId || null,
      data.IsTaxIncluded !== undefined ? data.IsTaxIncluded : false,
      data.Active !== undefined ? data.Active : true,
      userPhone,
      userPhone,
    ];
  }

  prepareUpdateParams(data, existing, userPhone, id, tenantId) {
    return [
      data.Amount !== undefined ? data.Amount : existing.Amount,
      data.TaxGroupId !== undefined ? data.TaxGroupId : existing.TaxGroupId,
      data.IsTaxIncluded !== undefined
        ? data.IsTaxIncluded
        : existing.IsTaxIncluded,
      data.Active !== undefined ? data.Active : existing.Active,
      userPhone,
      id,
      tenantId,
    ];
  }
}

const service = new CostInfoService();
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
};
