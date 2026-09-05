// src/modules/itemdetail/itemdetail.service.js
const BaseCRUDService = require('../../common/BaseCRUDService');
const { QUERIES } = require('../../config/constants');
const { attachBreakdown, attachBreakdownToOne } = require('../pricing/pricing.enrich');

const PRICING_OPTS = { idField: 'CostInfoId' };

class ItemDetailService extends BaseCRUDService {
  constructor() {
    super('Item Detail', QUERIES.ITEM_DETAIL);
  }

  // The item owns its price via CostInfoId; on ?expand=true resolve the tax
  // chain so the unit price is shown net / tax / gross rather than raw.
  async getAll(tenantId, page, limit, expand) {
    const result = await super.getAll(tenantId, page, limit, expand);
    if (!expand) return result;
    return { ...result, data: await attachBreakdown(result.data, tenantId, PRICING_OPTS) };
  }

  async getById(id, tenantId, expand) {
    const row = await super.getById(id, tenantId, expand);
    if (!expand) return row;
    return attachBreakdownToOne(row, tenantId, PRICING_OPTS);
  }

  prepareInsertParams(id, data, tenantId, userPhone) {
    return [
      id,
      tenantId,
      data.Name,
      data.Code || null,
      data.Description || null,
      data.CategoryId || null,
      data.UOMId || null,
      data.CostInfoId || null,
      data.SKU || null,
      data.Barcode || null,
      data.HSNCode || null,
      data.Active !== undefined ? data.Active : true,
      userPhone,
      userPhone,
    ];
  }

  prepareUpdateParams(data, existing, userPhone, id, tenantId) {
    return [
      data.Name !== undefined ? data.Name : existing.Name,
      data.Code !== undefined ? data.Code : existing.Code,
      data.Description !== undefined ? data.Description : existing.Description,
      data.CategoryId !== undefined ? data.CategoryId : existing.CategoryId,
      data.UOMId !== undefined ? data.UOMId : existing.UOMId,
      data.CostInfoId !== undefined ? data.CostInfoId : existing.CostInfoId,
      data.SKU !== undefined ? data.SKU : existing.SKU,
      data.Barcode !== undefined ? data.Barcode : existing.Barcode,
      data.HSNCode !== undefined ? data.HSNCode : existing.HSNCode,
      data.Active !== undefined ? data.Active : existing.Active,
      userPhone,
      id,
      tenantId,
    ];
  }
}

const service = new ItemDetailService();
module.exports = {
  createTx: (conn, data, tenantId, userPhone) => service.createTx(conn, data, tenantId, userPhone),
  // Exposed for the bulk import's update mode, which re-points an item at a new
  // cost info inside one transaction. Same wrapper shape as createTx above.
  updateTx: (conn, id, data, tenantId, userPhone) =>
    service.updateTx(conn, id, data, tenantId, userPhone),
  getAll: (tenantId, page, limit, expand) =>
    service.getAll(tenantId, page, limit, expand),
  getById: (id, tenantId, expand) => service.getById(id, tenantId, expand),
  create: (data, tenantId, userPhone) =>
    service.create(data, tenantId, userPhone),
  update: (id, data, tenantId, userPhone) =>
    service.update(id, data, tenantId, userPhone),
  delete: (id, tenantId) => service.delete(id, tenantId),
};
