// src/modules/posaddon/posaddon.service.js
// POS Add-on master service — business logic extending BaseCRUDService.
//
// One selectable option inside a pos_addon_group. FoodTypeId is the dietary tag
// on the ADD-ON ITSELF, reusing the existing food type master rather than a
// second veg flag beside it: a veg pizza with a chicken topping is not a veg
// order, and only that column can say so.

const BaseCRUDService = require('../../common/BaseCRUDService');
const { QUERIES } = require('../../config/constants');
const { executeQuery } = require('../../utils/dbHelper');

class PosAddonService extends BaseCRUDService {
  constructor() {
    super('POS Add-on', QUERIES.POS_ADDON);
  }

  prepareInsertParams(id, data, tenantId, userPhone) {
    return [
      id,
      tenantId,
      data.AddonGroupId ?? null,
      data.Name ?? null,
      data.Code ?? null,
      data.Price !== undefined ? data.Price : 0,
      data.FoodTypeId ?? null,
      data.SortOrder !== undefined ? data.SortOrder : 0,
      data.Active !== undefined ? data.Active : true,
      userPhone,
      userPhone,
    ];
  }

  prepareUpdateParams(data, existing, userPhone, id, tenantId) {
    return [
      data.AddonGroupId !== undefined ? data.AddonGroupId : existing.AddonGroupId,
      data.Name !== undefined ? data.Name : existing.Name,
      data.Code !== undefined ? data.Code : existing.Code,
      data.Price !== undefined ? data.Price : existing.Price,
      data.FoodTypeId !== undefined ? data.FoodTypeId : existing.FoodTypeId,
      data.SortOrder !== undefined ? data.SortOrder : existing.SortOrder,
      data.Active !== undefined ? data.Active : existing.Active,
      userPhone,
      id,
      tenantId,
    ];
  }

  /**
   * Every option in one group, in display order — what the menu editor draws
   * when a group is expanded.
   *
   * @param {string} addonGroupId
   * @param {string} tenantId
   */
  async getByGroup(addonGroupId, tenantId) {
    return executeQuery(this.queries.SELECT_BY_GROUP, [addonGroupId, tenantId]);
  }
}

const service = new PosAddonService();

module.exports = {
  getAll: (tenantId, page, limit) => service.getAll(tenantId, page, limit),
  getById: (id, tenantId) => service.getById(id, tenantId),
  getByGroup: (addonGroupId, tenantId) => service.getByGroup(addonGroupId, tenantId),
  create: (data, tenantId, userPhone) => service.create(data, tenantId, userPhone),
  update: (id, data, tenantId, userPhone) => service.update(id, data, tenantId, userPhone),
  remove: (id, tenantId) => service.delete(id, tenantId),
};
