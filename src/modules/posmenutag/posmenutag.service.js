// src/modules/posmenutag/posmenutag.service.js
// POS Menu Tag master service — business logic extending BaseCRUDService.
//
// ONE master, three uses. TagType separates CATEGORY / BEVERAGE / CUISINE tags
// rather than giving each its own table: three tables would be three sets of
// CRUD, three routes and three chances for the vocabularies to drift apart,
// for no gain over a column.

const BaseCRUDService = require('../../common/BaseCRUDService');
const { QUERIES, POS_MENU_TAG_TYPES } = require('../../config/constants');
const { executeQuery } = require('../../utils/dbHelper');

class PosMenuTagService extends BaseCRUDService {
  constructor() {
    super('POS Menu Tag', QUERIES.POS_MENU_TAG);
  }

  prepareInsertParams(id, data, tenantId, userPhone) {
    return [
      id,
      tenantId,
      data.Name ?? null,
      data.Code ?? null,
      data.TagType ?? POS_MENU_TAG_TYPES.CATEGORY,
      data.SortOrder !== undefined ? data.SortOrder : 0,
      data.Active !== undefined ? data.Active : true,
      userPhone,
      userPhone,
    ];
  }

  prepareUpdateParams(data, existing, userPhone, id, tenantId) {
    return [
      data.Name !== undefined ? data.Name : existing.Name,
      data.Code !== undefined ? data.Code : existing.Code,
      data.TagType !== undefined ? data.TagType : existing.TagType,
      data.SortOrder !== undefined ? data.SortOrder : existing.SortOrder,
      data.Active !== undefined ? data.Active : existing.Active,
      userPhone,
      id,
      tenantId,
    ];
  }

  /**
   * Active tags of one type, for a picker that must not offer the other two.
   * @param {string} tagType CATEGORY | BEVERAGE | CUISINE
   * @param {string} tenantId
   */
  async getByType(tagType, tenantId) {
    return executeQuery(this.queries.SELECT_BY_TYPE, [tagType, tenantId]);
  }
}

const service = new PosMenuTagService();

module.exports = {
  getAll: (tenantId, page, limit) => service.getAll(tenantId, page, limit),
  getById: (id, tenantId) => service.getById(id, tenantId),
  getByType: (tagType, tenantId) => service.getByType(tagType, tenantId),
  create: (data, tenantId, userPhone) => service.create(data, tenantId, userPhone),
  update: (id, data, tenantId, userPhone) => service.update(id, data, tenantId, userPhone),
  remove: (id, tenantId) => service.delete(id, tenantId),
};
