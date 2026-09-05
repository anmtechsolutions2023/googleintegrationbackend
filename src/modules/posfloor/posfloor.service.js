// src/modules/posfloor/posfloor.service.js
// POS Floor service — business logic extending BaseCRUDService (SRP + DIP).

const BaseCRUDService = require('../../common/BaseCRUDService');
const { QUERIES } = require('../../config/constants');
const { deleteOrRetire } = require('../../common/retire');

class PosFloorService extends BaseCRUDService {
  constructor() {
    super('POS Floor', QUERIES.POS_FLOOR);
  }

  /**
   * Remove a floor from the plan.
   *
   * A floor that still has tables — including retired ones — is retired rather
   * than deleted, so the tables it held keep their parent and the venue reports
   * keep their grouping.
   */
  async retire(id, tenantId, userPhone) {
    return deleteOrRetire({
      table: 'pos_floor',
      entityName: 'POS Floor',
      references: [{ table: 'pos_table', column: 'FloorId' }],
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
      data.BranchDetailId ?? null,
      data.Active !== undefined ? data.Active : true,
      userPhone,
      userPhone,
    ];
  }

  prepareUpdateParams(data, existing, userPhone, id, tenantId) {
    return [
      data.Name !== undefined ? data.Name : existing.Name,
      data.BranchDetailId !== undefined ? data.BranchDetailId : existing.BranchDetailId,
      data.Active !== undefined ? data.Active : existing.Active,
      userPhone,
      id,
      tenantId,
    ];
  }
}

const service = new PosFloorService();

module.exports = {
  getAll: (tenantId, page, limit) => service.getAll(tenantId, page, limit),
  getById: (id, tenantId) => service.getById(id, tenantId),
  create: (data, tenantId, userPhone) => service.create(data, tenantId, userPhone),
  update: (id, data, tenantId, userPhone) => service.update(id, data, tenantId, userPhone),
  remove: (id, tenantId, userPhone) => service.retire(id, tenantId, userPhone),
};
