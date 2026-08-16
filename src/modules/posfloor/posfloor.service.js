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
  async retire(id, tenantId, userEmail) {
    return deleteOrRetire({
      table: 'pos_floor',
      entityName: 'POS Floor',
      references: [{ table: 'pos_table', column: 'FloorId' }],
      deleteQuery: this.queries.DELETE,
      id,
      tenantId,
      userEmail,
    });
  }

  prepareInsertParams(id, data, tenantId, userEmail) {
    return [
      id,
      tenantId,
      data.Name ?? null,
      data.BranchDetailId ?? null,
      data.Active !== undefined ? data.Active : true,
      userEmail,
      userEmail,
    ];
  }

  prepareUpdateParams(data, existing, userEmail, id, tenantId) {
    return [
      data.Name !== undefined ? data.Name : existing.Name,
      data.BranchDetailId !== undefined ? data.BranchDetailId : existing.BranchDetailId,
      data.Active !== undefined ? data.Active : existing.Active,
      userEmail,
      id,
      tenantId,
    ];
  }
}

const service = new PosFloorService();

module.exports = {
  getAll: (tenantId, page, limit) => service.getAll(tenantId, page, limit),
  getById: (id, tenantId) => service.getById(id, tenantId),
  create: (data, tenantId, userEmail) => service.create(data, tenantId, userEmail),
  update: (id, data, tenantId, userEmail) => service.update(id, data, tenantId, userEmail),
  remove: (id, tenantId, userEmail) => service.retire(id, tenantId, userEmail),
};
