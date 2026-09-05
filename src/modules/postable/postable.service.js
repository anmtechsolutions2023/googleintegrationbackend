// src/modules/postable/postable.service.js
// POS Table service — business logic extending BaseCRUDService (SRP + DIP).

const BaseCRUDService = require('../../common/BaseCRUDService');
const { QUERIES } = require('../../config/constants');
const { deleteOrRetire } = require('../../common/retire');

class PosTableService extends BaseCRUDService {
  constructor() {
    super('POS Table', QUERIES.POS_TABLE);
  }

  /**
   * Remove a table from the floor plan.
   *
   * A table that has served orders is retired (Active = 0), not deleted: its
   * trading history is what the venue reports are built on, and pos_order.TableId
   * is a FOREIGN KEY that would reject the delete with an opaque error anyway.
   */
  async retire(id, tenantId, userPhone) {
    return deleteOrRetire({
      table: 'pos_table',
      entityName: 'POS Table',
      references: [{ table: 'pos_order', column: 'TableId' }],
      deleteQuery: this.queries.DELETE,
      id,
      tenantId,
      userPhone,
    });
  }

  prepareInsertParams(id, data, tenantId, userPhone) {
    return [
      id,
      tenantId,
      data.Name ?? null,
      data.FloorId ?? null,
      data.Capacity ?? null,
      data.Status ?? null,
      data.CurrentOrderId ?? null,
      data.BranchDetailId ?? null,
      data.Active !== undefined ? data.Active : true,
      userPhone,
      userPhone,
    ];
  }

  prepareUpdateParams(data, existing, userPhone, id, tenantId) {
    return [
      data.Name !== undefined ? data.Name : existing.Name,
      data.FloorId !== undefined ? data.FloorId : existing.FloorId,
      data.Capacity !== undefined ? data.Capacity : existing.Capacity,
      data.Status !== undefined ? data.Status : existing.Status,
      data.CurrentOrderId !== undefined ? data.CurrentOrderId : existing.CurrentOrderId,
      data.BranchDetailId !== undefined ? data.BranchDetailId : existing.BranchDetailId,
      data.Active !== undefined ? data.Active : existing.Active,
      userPhone,
      id,
      tenantId,
    ];
  }
}

const service = new PosTableService();

module.exports = {
  getAll: (tenantId, page, limit) => service.getAll(tenantId, page, limit),
  getById: (id, tenantId) => service.getById(id, tenantId),
  create: (data, tenantId, userPhone) => service.create(data, tenantId, userPhone),
  update: (id, data, tenantId, userPhone) => service.update(id, data, tenantId, userPhone),
  remove: (id, tenantId, userPhone) => service.retire(id, tenantId, userPhone),
};
