// src/modules/itemdetail/itemdetail.service.js
const BaseCRUDService = require('../../common/BaseCRUDService');
const { QUERIES } = require('../../config/constants');

class ItemDetailService extends BaseCRUDService {
  constructor() {
    super('Item Detail', QUERIES.ITEM_DETAIL);
  }

  prepareInsertParams(id, data, tenantId, userEmail) {
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
      userEmail,
      userEmail,
    ];
  }

  prepareUpdateParams(data, existing, userEmail, id, tenantId) {
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
      userEmail,
      id,
      tenantId,
    ];
  }
}

const service = new ItemDetailService();
module.exports = {
  createTx: (conn, data, tenantId, userEmail) => service.createTx(conn, data, tenantId, userEmail),
  getAll: (tenantId, page, limit, expand) =>
    service.getAll(tenantId, page, limit, expand),
  getById: (id, tenantId, expand) => service.getById(id, tenantId, expand),
  create: (data, tenantId, userEmail) =>
    service.create(data, tenantId, userEmail),
  update: (id, data, tenantId, userEmail) =>
    service.update(id, data, tenantId, userEmail),
  delete: (id, tenantId) => service.delete(id, tenantId),
};
