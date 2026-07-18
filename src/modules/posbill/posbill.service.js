// src/modules/posbill/posbill.service.js
// POS Bill service — business logic extending BaseCRUDService (SRP + DIP).

const BaseCRUDService = require('../../common/BaseCRUDService');
const { QUERIES } = require('../../config/constants');
const { withTransaction } = require('../../utils/dbHelper');

// Serialize object/array values for JSON columns; pass through strings and null.
const toJson = (v) => (v == null ? null : typeof v === 'string' ? v : JSON.stringify(v));

class PosBillService extends BaseCRUDService {
  constructor() {
    super('POS Bill', QUERIES.POS_BILL);
  }

  /**
   * Domain action: settle a bill — record payments and mark it paid.
   * Runs in a transaction so the read + settle are atomic.
   * @param {string} id - Bill ID
   * @param {Object} data - { Payments, Discount?, Total? }
   * @param {string} tenantId - Tenant ID
   * @param {string} userEmail - Acting user
   * @returns {Promise<Object>} Settled bill
   */
  async settle(id, data, tenantId, userEmail) {
    return withTransaction(async (connection) => {
      const existing = await this.getById(id, tenantId); // 404 if missing
      const discount = data.Discount !== undefined ? data.Discount : existing.Discount;
      const total = data.Total !== undefined ? data.Total : existing.Total;
      await connection.execute(this.queries.SETTLE, [
        toJson(data.Payments),
        discount,
        total,
        'paid',
        userEmail,
        id,
        tenantId,
      ]);
      return this.getById(id, tenantId);
    });
  }

  prepareInsertParams(id, data, tenantId, userEmail) {
    return [
      id,
      tenantId,
      data.BillNo ?? null,
      data.OrderId ?? null,
      data.SubTotal !== undefined ? data.SubTotal : 0,
      data.TaxAmount !== undefined ? data.TaxAmount : 0,
      data.Discount !== undefined ? data.Discount : 0,
      data.Total !== undefined ? data.Total : 0,
      toJson(data.Payments),
      data.Status ?? null,
      data.SettledAt ?? null,
      data.BranchDetailId ?? null,
      data.Active !== undefined ? data.Active : true,
      userEmail,
      userEmail,
    ];
  }

  prepareUpdateParams(data, existing, userEmail, id, tenantId) {
    return [
      data.BillNo !== undefined ? data.BillNo : existing.BillNo,
      data.OrderId !== undefined ? data.OrderId : existing.OrderId,
      data.SubTotal !== undefined ? data.SubTotal : existing.SubTotal,
      data.TaxAmount !== undefined ? data.TaxAmount : existing.TaxAmount,
      data.Discount !== undefined ? data.Discount : existing.Discount,
      data.Total !== undefined ? data.Total : existing.Total,
      data.Payments !== undefined ? toJson(data.Payments) : toJson(existing.Payments),
      data.Status !== undefined ? data.Status : existing.Status,
      data.SettledAt !== undefined ? data.SettledAt : existing.SettledAt,
      data.BranchDetailId !== undefined ? data.BranchDetailId : existing.BranchDetailId,
      data.Active !== undefined ? data.Active : existing.Active,
      userEmail,
      id,
      tenantId,
    ];
  }
}

const service = new PosBillService();

module.exports = {
  getAll: (tenantId, page, limit) => service.getAll(tenantId, page, limit),
  getById: (id, tenantId) => service.getById(id, tenantId),
  create: (data, tenantId, userEmail) => service.create(data, tenantId, userEmail),
  update: (id, data, tenantId, userEmail) => service.update(id, data, tenantId, userEmail),
  remove: (id, tenantId) => service.delete(id, tenantId),
  settle: (id, data, tenantId, userEmail) => service.settle(id, data, tenantId, userEmail),
};
