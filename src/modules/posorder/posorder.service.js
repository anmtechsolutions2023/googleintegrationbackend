// src/modules/posorder/posorder.service.js
// POS Order service — business logic extending BaseCRUDService (SRP + DIP).

const { v4: uuidv4 } = require('uuid');
const BaseCRUDService = require('../../common/BaseCRUDService');
const { QUERIES } = require('../../config/constants');
const { withTransaction } = require('../../utils/dbHelper');

// Serialize object/array values for JSON columns; pass through strings and null.
const toJson = (v) => (v == null ? null : typeof v === 'string' ? v : JSON.stringify(v));

class PosOrderService extends BaseCRUDService {
  constructor() {
    super('POS Order', QUERIES.POS_ORDER);
  }

  /**
   * Domain action: fire a KOT from an order — snapshots the order's items into a
   * new pos_kot row and marks the order 'fired'. Atomic (single transaction).
   * @param {string} id - Order ID
   * @param {Object} data - Optional { KotNo }
   * @param {string} tenantId - Tenant ID
   * @param {string} userEmail - Acting user
   * @returns {Promise<Object>} The created KOT summary
   */
  async fireKot(id, data, tenantId, userEmail) {
    return withTransaction(async (connection) => {
      const order = await this.getById(id, tenantId); // 404 if missing
      const kotId = uuidv4();
      const kotNo = (data && data.KotNo) || `KOT-${Date.now()}`;
      await connection.execute(QUERIES.POS_KOT.INSERT, [
        kotId,
        tenantId,
        kotNo,
        order.Id,
        order.TableId,
        toJson(order.Items),
        'pending',
        new Date(),
        order.BranchDetailId,
        1,
        userEmail,
        userEmail,
      ]);
      await connection.execute(this.queries.SET_STATUS, [
        'fired',
        userEmail,
        id,
        tenantId,
      ]);
      return { KotId: kotId, KotNo: kotNo, OrderId: order.Id, Status: 'pending' };
    });
  }

  prepareInsertParams(id, data, tenantId, userEmail) {
    return [
      id,
      tenantId,
      data.OrderNo ?? null,
      data.TableId ?? null,
      data.CustomerId ?? null,
      data.OrderType ?? null,
      data.Status ?? null,
      toJson(data.Items),
      data.SubTotal !== undefined ? data.SubTotal : 0,
      data.TaxAmount !== undefined ? data.TaxAmount : 0,
      data.Total !== undefined ? data.Total : 0,
      data.BranchDetailId ?? null,
      data.Active !== undefined ? data.Active : true,
      userEmail,
      userEmail,
    ];
  }

  prepareUpdateParams(data, existing, userEmail, id, tenantId) {
    return [
      data.OrderNo !== undefined ? data.OrderNo : existing.OrderNo,
      data.TableId !== undefined ? data.TableId : existing.TableId,
      data.CustomerId !== undefined ? data.CustomerId : existing.CustomerId,
      data.OrderType !== undefined ? data.OrderType : existing.OrderType,
      data.Status !== undefined ? data.Status : existing.Status,
      data.Items !== undefined ? toJson(data.Items) : toJson(existing.Items),
      data.SubTotal !== undefined ? data.SubTotal : existing.SubTotal,
      data.TaxAmount !== undefined ? data.TaxAmount : existing.TaxAmount,
      data.Total !== undefined ? data.Total : existing.Total,
      data.BranchDetailId !== undefined ? data.BranchDetailId : existing.BranchDetailId,
      data.Active !== undefined ? data.Active : existing.Active,
      userEmail,
      id,
      tenantId,
    ];
  }
}

const service = new PosOrderService();

module.exports = {
  getAll: (tenantId, page, limit) => service.getAll(tenantId, page, limit),
  getById: (id, tenantId) => service.getById(id, tenantId),
  create: (data, tenantId, userEmail) => service.create(data, tenantId, userEmail),
  update: (id, data, tenantId, userEmail) => service.update(id, data, tenantId, userEmail),
  remove: (id, tenantId) => service.delete(id, tenantId),
  fireKot: (id, data, tenantId, userEmail) => service.fireKot(id, data, tenantId, userEmail),
};
