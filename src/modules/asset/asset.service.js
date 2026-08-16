// src/modules/asset/asset.service.js
// Fixed-asset register — what equipment each branch has and what it is worth.
//
// An asset belongs to a BRANCH. That is the register's reason to exist: "which
// outlet has this fryer, and what did it cost". Tenant-level assets with no
// branch would answer none of the questions the register is for, so
// BranchDetailId is NOT NULL.
//
// Depreciation is deliberately out of scope: it needs a schedule table and a
// periodic posting job, and nothing here requires it yet.

const BaseCRUDService = require('../../common/BaseCRUDService');
const { QUERIES, ASSET_STATUS } = require('../../config/constants');
const { withConnection } = require('../../utils/dbHelper');

class AssetService extends BaseCRUDService {
  constructor() {
    super('Asset', QUERIES.ASSET);
  }

  /** Register value grouped by branch and category. */
  async summary(tenantId) {
    return withConnection(async (conn) => {
      const [rows] = await conn.execute(this.queries.SUMMARY_BY_BRANCH, [tenantId]);
      const groups = rows.map((r) => ({
        ...r,
        Assets: Number(r.Assets || 0),
        PurchaseCost: Number(r.PurchaseCost || 0),
      }));
      return {
        groups,
        totalAssets: groups.reduce((s, g) => s + g.Assets, 0),
        totalValue: groups.reduce((s, g) => s + g.PurchaseCost, 0),
      };
    });
  }

  prepareInsertParams(id, data, tenantId, userEmail) {
    return [
      id,
      tenantId,
      data.Name ?? null,
      data.AssetCategoryId ?? null,
      data.BranchDetailId ?? null,
      // Empty string would collide under UNIQUE(SerialNo, TenantId) for every
      // asset without a serial; NULL does not.
      data.SerialNo || null,
      data.PurchaseDate ?? null,
      data.PurchaseCost !== undefined ? data.PurchaseCost : 0,
      data.SupplierContactDetailId ?? null,
      data.Status ?? ASSET_STATUS.IN_USE,
      data.Notes ?? null,
      data.Active !== undefined ? data.Active : true,
      userEmail,
      userEmail,
    ];
  }

  prepareUpdateParams(data, existing, userEmail, id, tenantId) {
    return [
      data.Name !== undefined ? data.Name : existing.Name,
      data.AssetCategoryId !== undefined ? data.AssetCategoryId : existing.AssetCategoryId,
      data.BranchDetailId !== undefined ? data.BranchDetailId : existing.BranchDetailId,
      data.SerialNo !== undefined ? (data.SerialNo || null) : existing.SerialNo,
      data.PurchaseDate !== undefined ? data.PurchaseDate : existing.PurchaseDate,
      data.PurchaseCost !== undefined ? data.PurchaseCost : existing.PurchaseCost,
      data.SupplierContactDetailId !== undefined
        ? data.SupplierContactDetailId : existing.SupplierContactDetailId,
      data.Status !== undefined ? data.Status : existing.Status,
      data.Notes !== undefined ? data.Notes : existing.Notes,
      data.Active !== undefined ? data.Active : existing.Active,
      userEmail,
      id,
      tenantId,
    ];
  }
}

const service = new AssetService();

module.exports = {
  getAll: (tenantId, page, limit) => service.getAll(tenantId, page, limit),
  getById: (id, tenantId) => service.getById(id, tenantId),
  create: (data, tenantId, userEmail) => service.create(data, tenantId, userEmail),
  update: (id, data, tenantId, userEmail) => service.update(id, data, tenantId, userEmail),
  remove: (id, tenantId) => service.delete(id, tenantId),
  summary: (tenantId) => service.summary(tenantId),
};
